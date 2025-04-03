import { config } from 'dotenv';
import { SecretNetworkClient, } from 'secretjs';
import * as fs from 'fs';

config();

enum Type {
  PRIVATE = 'private',
  SILK = 'silk',
  XTOKEN = 'xToken',
}

interface GraphQLResponse<T> {
  data?: T,
  errors?: Array<{
    message: string,
    locations: Array<{
      line: number,
      column: number,
    }>,
    extensions?: {
      code: string,
    },
  }>,
}

const client = new SecretNetworkClient({
  url: process.env.NODE!,
  chainId: process.env.CHAIN_ID!,
  encryptionSeed: Uint8Array.from(process.env.ENCRYPTION_SEED!.split(',').map(Number)),
});

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  if (!fs.existsSync('./notified.txt')) {
    const initialState: string[] = [];
    fs.writeFileSync('./notified.txt', JSON.stringify(initialState));
  }
  const hasNotified = JSON.parse(fs.readFileSync('./notified.txt', 'utf-8'));
  const transactions = fs.readFileSync('../transactions.txt', 'utf-8').split('\n').map(
    (tx) =>  {
      const txArray = tx.split(',');
      return {
        time: new Date(Number(txArray[0]) * 10),
        hash: txArray[1],
        type: txArray[2] as Type,
      }
    }
  ).filter((tx) => tx.hash && !hasNotified.includes(tx.hash));

    const response2 = await client.query.getTx('E7BD0388ED0475578ABCEC29F1F807C78C777D5E79B9019127002FDC30BED3C3');
    console.log(JSON.stringify(response2, null, 2))

  if (transactions.length === 0) {
    return;
  }

  const txActions: { token:string; amount: string; type: string}[] = [];
  const failedTxs: { type: string; hash: string }[] = [];
  for (let i = 0; i < transactions.length; i++) {
    await delay(5000); // 1 second delay between calls
    const tx = transactions[i];
    const response = await client.query.getTx(tx.hash);
    if(response === null || response === undefined) {
      continue;
    }
    if(response?.code !== 0) {
      failedTxs.push(tx);
      continue;
    }
    if(response?.jsonLog && tx.type === Type.PRIVATE) {
      const event = response.jsonLog[0].events.find((log) => log.type === 'wasm');
      const token = event?.attributes.find(
        (attr) => attr.key.trim() === 'caller_share_token'
      )?.value;
      const amount = event?.attributes.find(
        (attr) => attr.key.trim() === 'caller_share_amount'
      )?.value;
      if(token && amount) {
        txActions.push({
          token,
          amount,
          type: tx.type
        });
      }
    } else if (response?.jsonLog && tx.type === Type.SILK) {
      const event = response.jsonLog[0].events.find((log) => log.type === 'wasm');
      const amountIndex = event?.attributes.map(
        (attr) => attr.key.trim()
      ).indexOf('liquidator_share');
      if(amountIndex !== undefined && amountIndex !== -1) {
        const token = event?.attributes.find((attr, index) => {
          return attr.key.trim() === 'contract_address' && index > amountIndex;
        })?.value;
        const amount = event?.attributes[amountIndex]?.value;
        if(token && amount) {
          txActions.push({
            token,
            amount,
            type: tx.type
          });
        }
      }
    } else if (response?.jsonLog && tx.type === Type.XTOKEN) {
      const event1 = response.jsonLog[1].events.find((log) => log.type === 'wasm');
      const event2 = response.jsonLog[2].events.find((log) => log.type === 'wasm');
      const token = event1?.attributes.find((attr) => attr.key.trim() === 'token')?.value 
        ?? event2?.attributes.find((attr) => attr.key.trim() === 'token')?.value;
      const inputAmount = event1?.attributes.find((attr) => attr.key.trim() === 'amount_in')?.value
          ?? event1?.attributes.find((attr) => attr.key.trim() === 'token_deposited')?.value;
      const outputAmount = event2?.attributes.find(
          (attr) => attr.key.trim() === 'token_withdraw_amount'
        )?.value
          ?? event2?.attributes.find((attr) => attr.key.trim() === 'amount_out')?.value;
      if(token && inputAmount && outputAmount) {
        txActions.push({
          token,
          amount: String(Number(outputAmount) - Number(inputAmount)),
          type: tx.type
        });
      }
    }
  }

  if(failedTxs.length > 0) {
    let message = '';
    
    Object.values(Type).forEach((type) => {
      const typeFailed = failedTxs.filter((tx) => tx.type === type);
      if (typeFailed.length > 0) {
        message += `${type}: ${typeFailed.length} failed transactions\n`;
      }
    });

    const notificationPayload = {
        message: message,
        title: 'Failed Transaction Alert',
        priority: 0
    };


    try {
      const response = await fetch(`https://api.pushover.net/1/messages.json`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', },
          body: JSON.stringify({
              ...notificationPayload,
              token: process.env.PUSHOVER_TOKEN,
              user: process.env.PUSHOVER_USER,
          })
      });

      if (!response.ok) {
          console.error('Notification Error:', await response.text());
      }
    } catch (err) {
      console.error('Failed to send notification:', err);
    }

    failedTxs.forEach(tx => hasNotified.push(tx.hash));
    if(txActions.length === 0) {
      fs.writeFileSync('./notified.txt', JSON.stringify(hasNotified));
    }
  }

  if(txActions.length === 0) {
    return;
  }

  let query = `
    query Prices {
      prices(query: {}) {
        id
        value
      }
    }
  `;

  const gqlPriceResp = await fetch(process.env.GRAPHQL!, {
      method: "POST",
      headers: { "Content-Type": "application/json", },
      body: JSON.stringify({ query, })
  });
  const priceBody: GraphQLResponse<{
    prices:{id: string; value:number}[],
  }> = await gqlPriceResp.json();
  if (priceBody.errors || priceBody.data == undefined) {
      console.error("GraphQL Price Errors:", priceBody.errors);
      return;
  }
  query = `
    query Tokens {
      tokens(query: {
        where: {
          flags: {
            has: SNIP20
          }
        }
      }) {
        id
        contractAddress
        symbol
        Asset {
          decimals
        }
        PriceToken{
          priceId
        }
      }
    }
  `;

  const gqlTokenResp = await fetch(process.env.GRAPHQL!, {
      method: "POST",
      headers: { "Content-Type": "application/json", },
      body: JSON.stringify({ query, })
  });
  const tokenBody: GraphQLResponse<{
    tokens: {
      id: string, 
      contractAddress: string, 
      symbol: string,
      Asset: {decimals: number}, 
      PriceToken: {priceId: string}[],
    }[],
  }> = await gqlTokenResp.json();
  if (tokenBody.errors || tokenBody.data == undefined) {
      console.error("GraphQL Token Errors:", tokenBody.errors);
      return;
  }

  for (let i = 0; i < txActions.length; i++) {
    const txAction = txActions[i];
    const token = tokenBody.data.tokens.find(
      (apiToken) => apiToken.contractAddress === txAction.token
    );
    const price = priceBody.data.prices.find((apiPrice) => {
      const tokenPriceIds = token?.PriceToken.map((priceToken) => priceToken.priceId) ?? [];
      return tokenPriceIds.includes(apiPrice.id) && apiPrice.value !== null && apiPrice.value > 0;
    });
    if(token && price) {
      const amount = Number(txAction.amount) / 10 ** token.Asset.decimals;
      const value = amount * price.value;
      const message = `Type: ${txAction.type}, Value: $${value.toFixed(4)}, ` +
        `Token: ${token.symbol}, Amount: ${amount}`;
      
      const notificationPayload = {
          message: message,
          title: 'New Transaction Alert',
          priority: 0
      };

      try {
          const response = await fetch(`https://api.pushover.net/1/messages.json`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', },
              body: JSON.stringify({
                  ...notificationPayload,
                  token: process.env.PUSHOVER_TOKEN,
                  user: process.env.PUSHOVER_USER,
              })
          });

          if (!response.ok) {
              console.error('Notification Error:', await response.text());
          }
      } catch (err) {
          console.error('Failed to send notification:', err);
      }
    }
  }

  transactions.forEach(tx => hasNotified.push(tx.hash));
  fs.writeFileSync('./notified.txt', JSON.stringify(hasNotified));
}

main().catch(console.error);

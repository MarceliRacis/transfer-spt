const { createClient } = require('redis');

let client = null;

async function getRedis() {
  if (client && client.isOpen) return client;

  client = createClient({
    url: process.env.REDIS_URL,
    socket: {
      reconnectStrategy: (retries) => Math.min(retries * 100, 3000)
    }
  });

  client.on('error', (err) => console.error('Redis error:', err));
  client.on('connect', () => console.log('✅ Redis connected'));

  await client.connect();
  return client;
}

module.exports = { getRedis };
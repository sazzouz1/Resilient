const path = require('path');
const store = require('./dataStore');
const exclusions = require('./exclusions');
const appConfig = require('./appConfig');
const router = require('./api/routes');
const { createServer } = require('./httpServer');
const { PORT } = require('./config');

appConfig.load();
exclusions.load();
store.refresh();

const server = createServer({
  router,
  staticDir: path.join(__dirname, '..', 'public'),
});

server.listen(PORT, () => {
  console.log(`\nResiliency Checker running -> http://localhost:${PORT}\n`);
});

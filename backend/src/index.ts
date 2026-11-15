import { app } from './app.js';
import { config } from './config.js';
import { prisma } from './db.js';
import { startSubscriber, type Subscriber } from './mqtt/subscriber.js';
import { waitForBackgroundWork } from './modules/assistant/service.js';

const server = app.listen(config.PORT, () => {
    console.log(`Server running at http://localhost:${config.PORT}`);
});

const subscriber: Subscriber | null = config.MQTT_URL ? startSubscriber(config.MQTT_URL) : null;
if (!subscriber) console.log('[mqtt] MQTT_URL not set: vitals subscriber disabled');

async function shutdown() {
    server.close();
    await subscriber?.stop();
    await waitForBackgroundWork(); // let in-flight assistant questions finish
    await prisma.$disconnect();
    process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

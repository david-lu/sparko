import { createApp, errorHandler } from '../server/app';

const app = await createApp();
app.use(errorHandler);
export default app;

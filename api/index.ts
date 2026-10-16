import { createApp } from '../server/app';
import { errorHandler } from '../server/shared/http';

const app = await createApp();
app.use(errorHandler);
export default app;

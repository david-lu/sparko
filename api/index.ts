import { createApp } from '../server/app.js';
import { errorHandler } from '../server/shared/http.js';

const app = await createApp();
app.use(errorHandler);
export default app;

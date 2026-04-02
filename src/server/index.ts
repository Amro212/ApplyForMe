import dotenv from "dotenv";
import { createApp } from "./app.js";

dotenv.config();

const port = Number(process.env.PORT ?? 3000);

const app = await createApp();

app.listen(port, () => {
  console.log(`Stagehand job dashboard running on http://localhost:${port}`);
});

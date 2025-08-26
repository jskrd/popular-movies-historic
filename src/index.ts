import { type Context, Hono } from "hono";
import { fetchLatest } from "lib/movies/api.js";

const app = new Hono();

app.get("/movies.json", async (context: Context) => {
	const movies = await fetchLatest();
	return context.json(movies);
});

export default app;

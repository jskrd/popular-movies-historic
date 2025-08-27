import { z } from "zod";

export const Movie = z.object({
	title: z.string(),
	imdb_id: z.string(),
	poster_url: z.string(),
});

export type Movie = z.infer<typeof Movie>;

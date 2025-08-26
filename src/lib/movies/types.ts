import { z } from "zod";

export const Movie = z.object({
	title: z.string(),
	tmdb_id: z.int(),
	imdb_id: z.string(),
	poster_url: z.string(),
	genres: z.array(z.string()),
});

export type Movie = z.infer<typeof Movie>;

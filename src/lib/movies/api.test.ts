import {
	appendUnique,
	baseUrl,
	getAllHistoricUrls,
	getHistoricUrl,
} from "src/lib/movies/api.js";
import { describe, expect, test } from "vitest";

describe("getHistoricUrl", () => {
	test.each([
		{
			case: "basic case",
			date: new Date(2000, 0, 1),
			expected: "/movies-20000101.json",
		},
		{
			case: "single digits",
			date: new Date(2000, 2, 5),
			expected: "/movies-20000305.json",
		},
		{
			case: "double digits",
			date: new Date(2000, 11, 25),
			expected: "/movies-20001225.json",
		},
		{
			case: "different year",
			date: new Date(2123, 0, 1),
			expected: "/movies-21230101.json",
		},
		{
			case: "leap year",
			date: new Date(2020, 1, 29),
			expected: "/movies-20200229.json",
		},
	])("formats date correctly for $case", ({ date, expected }) => {
		const url = getHistoricUrl(date);

		expect(url).toBe(`${baseUrl}${expected}`);
	});
});

describe("getAllHistoricUrls", () => {
	test.each([
		{
			case: "single day range",
			until: new Date(2019, 11, 2),
			expectedCount: 1,
			firstUrl: `${baseUrl}/movies-20191202.json`,
			lastUrl: `${baseUrl}/movies-20191202.json`,
		},
		{
			case: "few days range",
			until: new Date(2019, 11, 5),
			expectedCount: 4,
			firstUrl: `${baseUrl}/movies-20191202.json`,
			lastUrl: `${baseUrl}/movies-20191205.json`,
		},
		{
			case: "cross month boundary",
			until: new Date(2020, 0, 2),
			expectedCount: 32,
			firstUrl: `${baseUrl}/movies-20191202.json`,
			lastUrl: `${baseUrl}/movies-20200102.json`,
		},
		{
			case: "cross year boundary",
			until: new Date(2020, 1, 29),
			expectedCount: 90,
			firstUrl: `${baseUrl}/movies-20191202.json`,
			lastUrl: `${baseUrl}/movies-20200229.json`,
		},
	])(
		"generates URLs correctly for $case",
		({ until, expectedCount, firstUrl, lastUrl }) => {
			const urls = getAllHistoricUrls(until);

			expect(urls).toHaveLength(expectedCount);
			expect(urls[0]).toBe(firstUrl);
			expect(urls[urls.length - 1]).toBe(lastUrl);
		},
	);

	test("throws error for date before December 2, 2019", () => {
		const earlyDate = new Date(2019, 11, 1); // December 1, 2019

		expect(() => getAllHistoricUrls(earlyDate)).toThrow(
			"Date must be on or after 2 December 2019",
		);
	});
});

describe("appendUnique", () => {
	test.each([
		{
			case: "adds new movie to empty array",
			movies: [],
			newMovie: {
				tmdb_id: 123,
				title: "Test Movie",
				imdb_id: "tt1234567",
				poster_url: "https://example.com/poster.jpg",
				genres: ["Action", "Drama"],
			},
			expectedLength: 1,
			shouldContain: true,
		},
		{
			case: "adds new movie with unique tmdb_id",
			movies: [
				{
					tmdb_id: 456,
					title: "Existing Movie",
					imdb_id: "tt7654321",
					poster_url: "https://example.com/existing.jpg",
					genres: ["Comedy"],
				},
			],
			newMovie: {
				tmdb_id: 123,
				title: "Test Movie",
				imdb_id: "tt1234567",
				poster_url: "https://example.com/poster.jpg",
				genres: ["Action", "Drama"],
			},
			expectedLength: 2,
			shouldContain: true,
		},
		{
			case: "does not add movie with duplicate tmdb_id",
			movies: [
				{
					tmdb_id: 123,
					title: "Existing Movie",
					imdb_id: "tt7654321",
					poster_url: "https://example.com/existing.jpg",
					genres: ["Comedy"],
				},
			],
			newMovie: {
				tmdb_id: 123,
				title: "Different Title",
				imdb_id: "tt1234567",
				poster_url: "https://example.com/poster.jpg",
				genres: ["Action", "Drama"],
			},
			expectedLength: 1,
			shouldContain: false,
		},
	])("$case", ({ movies, newMovie, expectedLength, shouldContain }) => {
		const result = appendUnique(movies, newMovie);

		expect(result).toHaveLength(expectedLength);

		if (shouldContain) {
			expect(result).toContain(newMovie);
		} else {
			expect(result).not.toContain(newMovie);
		}

		// Should not mutate original array
		expect(movies).not.toBe(result);
	});
});

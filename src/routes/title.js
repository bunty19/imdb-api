import { Hono } from "hono";
import DomParser from "dom-parser";
import { decode as entityDecoder } from "html-entities";
import seriesFetcher, { parseEpisodes } from "../helpers/seriesFetcher";
import apiRequestRawHtml from "../helpers/apiRequestRawHtml";
import parseMoreInfo from "../helpers/parseMoreInfo";

const title = new Hono();

title.get("/:id", async (c) => {
  const id = c.req.param("id");

  try {
    let parser = new DomParser();
    let rawHtml = await apiRequestRawHtml(`https://www.imdb.com/title/${id}`);
    let dom = parser.parseFromString(rawHtml);

    let moreDetails = parseMoreInfo(dom);
    let response = {};

    // Schema parsing
    let schema = getNode(dom, "script", "application/ld+json");
    schema = JSON.parse(schema.innerHTML);

    // Response object initialization
    response.id = id;
    response.review_api_path = `/reviews/${id}`;
    response.imdb = `https://www.imdb.com/title/${id}`;
    response.contentType = schema["@type"];
    response.productionStatus = moreDetails.productionStatus;

    // Title extraction
    const titleNode = getNode(dom, "h1", "hero__pageTitle");
    response.title = titleNode 
      ? titleNode.querySelector('.hero__primary-text').textContent.trim() 
      : '';

    // Extracting original title
    const originalTitleNode = titleNode?.nextElementSibling;
    response.originalTitle = originalTitleNode 
      ? originalTitleNode.textContent.replace("Original title: ", "").trim() 
      : '';

    // Continue populating the response object
    response.image = schema.image;
    response.images = moreDetails.images;
    response.plot = entityDecoder(schema.description, { level: "html5" });

    // Rating and award details
    response.rating = {
      count: schema.aggregateRating?.ratingCount ?? 0,
      star: schema.aggregateRating?.ratingValue ?? 0,
    };
    response.award = moreDetails.award;
    response.contentRating = schema.contentRating;

    // Genre and release details
    response.genre = schema.genre?.map((e) => entityDecoder(e, { level: "html5" })) ?? [];
    response.releaseDetailed = moreDetails.releaseDetailed;
    if (!response.year && response.releaseDetailed.year !== -1) {
      response.year = response.releaseDetailed.year;
    }
    response.spokenLanguages = moreDetails.spokenLanguages;
    response.filmingLocations = moreDetails.filmingLocations;
    response.runtime = moreDetails.runtime;
    response.runtimeSeconds = moreDetails.runtimeSeconds;

    // Actors and directors extraction
    response.actors = schema.actor?.map(e => entityDecoder(e.name, { level: "html5" })) ?? [];
    response.directors = schema.director?.map(e => entityDecoder(e.name, { level: "html5" })) ?? [];

    // Top credits extraction
    try {
      const topCreditsNode = getNode(dom, "div", "title-pc-expanded-section").firstChild.firstChild;
      response.top_credits = topCreditsNode.childNodes.map(e => ({
        name: e.firstChild.textContent,
        value: e.childNodes[1].firstChild.childNodes.map(e => entityDecoder(e.textContent, { level: "html5" })),
      }));
    } catch (_) {
      response.top_credits = [];
    }

    // Season fetching for TV series
    if (["TVSeries"].includes(response.contentType)) {
      let seasons = await seriesFetcher(id);
      response.seasons = seasons.seasons;
      response.all_seasons = seasons.all_seasons;
    }

    return c.json(response);
  } catch (error) {
    c.status(500);
    return c.json({ message: error.message });
  }
});

title.get("/:id/season/:seasonId", async (c) => {
  const id = c.req.param("id");
  const seasonId = c.req.param("seasonId");

  try {
    const html = await apiRequestRawHtml(`https://www.imdb.com/title/${id}/episodes/_ajax?season=${seasonId}`);
    const parsed = parseEpisodes(html, seasonId);
    const response = {
      id,
      title_api_path: `/title/${id}`,
      imdb: `https://www.imdb.com/title/${id}/episodes?season=${seasonId}`,
      season_id: seasonId,
      ...parsed,
    };

    return c.json(response);
  } catch (error) {
    c.status(500);
    return c.json({ message: error.message });
  }
});

export default title;

function getNode(dom, tag, id) {
  return dom
    .getElementsByTagName(tag)
    .find(e => e.attributes.some(attr => attr.value === id));
}

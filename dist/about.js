import { withContentDefaults } from "./content-defaults.js";
import { applySiteContent, setupNavigation, setupLocalPreview } from "./site.js";

const responses = await Promise.all(["./content.json", "./images.json"].map((file) => fetch(new URL(file, import.meta.url), { cache: "no-cache" })));
if (responses.some((response) => !response.ok)) throw new Error("Unable to load author content");
let copy = withContentDefaults(await responses[0].json()), images = await responses[1].json();
function apply(content, nextImages) {
  copy = content;
  if (nextImages && typeof nextImages === "object") images = nextImages;
  applySiteContent(copy, images, { about: true });
}
apply(copy, images);
setupNavigation();
setupLocalPreview(() => copy, apply);

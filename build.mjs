import { fileURLToPath } from "node:url";
import { createContentStore } from "./content/store.mjs";

const store = createContentStore(fileURLToPath(new URL("./", import.meta.url)));
await store.build((await store.load()).content);
console.log("Built dist/index.html from template.html and dist/content.json.");

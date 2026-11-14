/**
 * The small window of story tags: names the GM switches on and off ("war has started"). Rows can ask for a tag to be
 * on or off. Every change is saved at once.
 */

import {MODULE_ID, TEMPLATES, addSettingsGear, setting, t} from "./config.mjs";
import {MAX_TAGS, tagId} from "./conditions.mjs";
import {saveStoryTags, storyTags} from "./situation.mjs";
import {countFeature} from "./usage.mjs";

const {ApplicationV2, HandlebarsApplicationMixin} = foundry.applications.api;

/**
 * Open the window (GM).
 * @returns {Promise<StoryTagsApp|null>}
 */
export async function openStoryTags() {
  if ( !game.user.isGM ) return null;
  const open = foundry.applications.instances.get("sdt-tags");
  if ( open?.rendered ) {
    open.bringToFront();
    return open;
  }
  const app = new StoryTagsApp();
  await app.render({force: true});
  return app;
}

export class StoryTagsApp extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @param {object} [options] */
  constructor(options = {}) {
    super({...options, id: "sdt-tags"});
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["sdt-app", "sdt-tags-app"],
    window: {icon: "fa-solid fa-tags", resizable: false},
    position: {width: 400, height: "auto"},
    actions: {add: StoryTagsApp.#onAdd, remove: StoryTagsApp.#onRemove}
  };

  /** @override */
  static PARTS = {main: {template: `${TEMPLATES}/tags.hbs`}};

  /** @override */
  get title() {
    return t("SDT.Tags.title");
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const tags = storyTags();
    context.tags = tags;
    context.empty = !tags.length;
    context.full = tags.length >= MAX_TAGS;
    return context;
  }

  /** @override */
  async _renderFrame(options) {
    const frame = await super._renderFrame(options);
    addSettingsGear(frame);
    return frame;
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.element.dataset.sdtTheme = setting("theme");
    for ( const row of this.element.querySelectorAll("[data-tag]") ) {
      const id = row.dataset.tag;
      row.querySelector("input[name=on]")?.addEventListener("change", async event => {
        const tags = storyTags();
        const tag = tags.find(entry => entry.id === id);
        if ( !tag ) return;
        tag.on = event.currentTarget.checked;
        await saveStoryTags(tags);
        countFeature(MODULE_ID, "storyTagSet");
      });
      row.querySelector("input[name=name]")?.addEventListener("change", async event => {
        const tags = storyTags();
        const tag = tags.find(entry => entry.id === id);
        const name = event.currentTarget.value.trim();
        if ( !tag || !name ) return this.render();
        tag.name = name;
        await saveStoryTags(tags);
      });
    }
    this.element.querySelector("input[name=newName]")?.addEventListener("keydown", event => {
      if ( event.key !== "Enter" ) return;
      event.preventDefault();
      StoryTagsApp.#onAdd.call(this);
    });
  }

  /** @this {StoryTagsApp} */
  static async #onAdd() {
    const field = this.element.querySelector("input[name=newName]");
    const name = field?.value.trim();
    if ( !name ) return;
    const tags = storyTags();
    if ( tags.length >= MAX_TAGS ) return;
    tags.push({id: tagId(name, tags.map(tag => tag.id)), name, on: false});
    await saveStoryTags(tags);
    this.render();
  }

  /** @this {StoryTagsApp} */
  static async #onRemove(event, target) {
    const id = target.closest("[data-tag]")?.dataset.tag;
    await saveStoryTags(storyTags().filter(tag => tag.id !== id));
    this.render();
  }
}

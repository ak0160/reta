// next.config.ts uses /reta in both development and production.
const BASE_PATH = "/reta";

export type StoryKey = "wagahai";

export const stories = {
  wagahai: {
    title: "吾輩は猫である",
    author: "夏目漱石",
    textFile: `${BASE_PATH}/texts/wagahaiwa_nekodearu.txt`,
    textSource: "aozora" as const,
    paragraphs: [],
  },
};

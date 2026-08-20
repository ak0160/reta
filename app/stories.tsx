const BASE_PATH =
  process.env.NODE_ENV === "production"
    ? "/reta"
    : "";

export type StoryKey =
  | "wagahai"
  | "dashi"
  | "hakuchumu"
  | "megachurch";

export const stories = {
  wagahai: {
    title: "吾輩は猫である",
    author: "夏目漱石",
    textFile: `${BASE_PATH}/texts/wagahaiwa_nekodearu.txt`,
    paragraphs: [],
  },

  dashi: {
    title: "だしの取り方",
    author: "北大路魯山人",
    textFile: `${BASE_PATH}/texts/dashi.txt`,
    paragraphs: [],
  },

  hakuchumu: {
    title: "白昼夢",
    author: "江戸川乱歩",
    textFile: `${BASE_PATH}/texts/hakuchumu.txt`,
    paragraphs: [],
  },

  megachurch: {
    title: "In The Megachurch",
    author: "朝井リョウ",
    textFile: `${BASE_PATH}/texts/megachurch.txt`,
    paragraphs: [],
  },
};
import {onRequest} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";

export const fetchAozora = onRequest(
  {
    region: "asia-northeast1",
    cors: true,
  },
  async (request, response) => {
    try {
      const url = String(request.query.url ?? "").trim();

      if (!url) {
        response.status(400).json({
          error: "青空文庫のURLを指定してください",
        });
        return;
      }

      let parsedUrl: URL;

      try {
        parsedUrl = new URL(url);
      } catch {
        response.status(400).json({
          error: "URLの形式が正しくありません",
        });
        return;
      }

      if (
        parsedUrl.protocol !== "https:" ||
        !(
          parsedUrl.hostname === "aozora.gr.jp" ||
          parsedUrl.hostname.endsWith(".aozora.gr.jp")
        )
      ) {
        response.status(400).json({
          error: "青空文庫のURLだけ対応しています",
        });
        return;
      }

      const aozoraResponse = await fetch(parsedUrl.toString(), {
        redirect: "follow",
        headers: {
          "User-Agent": "ReTA/1.0",
        },
      });

      if (!aozoraResponse.ok) {
        response.status(502).json({
          error: `青空文庫からの取得に失敗しました: ${aozoraResponse.status}`,
        });
        return;
      }

      const buffer = await aozoraResponse.arrayBuffer();

      response.set("Content-Type", "application/octet-stream");
      response.set("Cache-Control", "public, max-age=3600");
      response.status(200).send(Buffer.from(buffer));
    } catch (error) {
      logger.error("青空文庫の取得に失敗しました", error);

      response.status(500).json({
        error: "青空文庫の取得中にエラーが発生しました",
      });
    }
  },
);

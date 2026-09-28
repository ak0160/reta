export default {
  async fetch(request: Request): Promise<Response> {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    if (request.method !== "GET") {
      return Response.json(
        { error: "GETのみ対応しています" },
        { status: 405, headers: corsHeaders },
      );
    }

    try {
      const requestUrl = new URL(request.url);
      const target = requestUrl.searchParams.get("url")?.trim();

      if (!target) {
        return Response.json(
          { error: "青空文庫のURLを指定してください" },
          { status: 400, headers: corsHeaders },
        );
      }

      let aozoraUrl: URL;

      try {
        aozoraUrl = new URL(target);
      } catch {
        return Response.json(
          { error: "URLの形式が正しくありません" },
          { status: 400, headers: corsHeaders },
        );
      }

      if (
        aozoraUrl.protocol !== "https:" ||
        !(
          aozoraUrl.hostname === "aozora.gr.jp" ||
          aozoraUrl.hostname.endsWith(".aozora.gr.jp")
        )
      ) {
        return Response.json(
          { error: "青空文庫のURLだけ対応しています" },
          { status: 400, headers: corsHeaders },
        );
      }

      const response = await fetch(aozoraUrl.toString(), {
        redirect: "follow",
        headers: {
          "User-Agent": "ReTA/1.0",
        },
      });

      if (!response.ok) {
        return Response.json(
          { error: `青空文庫からの取得に失敗しました: ${response.status}` },
          { status: 502, headers: corsHeaders },
        );
      }

      const body = await response.arrayBuffer();

      return new Response(body, {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type":
            response.headers.get("Content-Type") ??
            "application/octet-stream",
          "Cache-Control": "public, max-age=3600",
        },
      });
    } catch (error) {
      console.error(error);

      return Response.json(
        { error: "青空文庫の取得中にエラーが発生しました" },
        { status: 500, headers: corsHeaders },
      );
    }
  },
};

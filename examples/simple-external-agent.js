import express from "express";

const app = express();
app.use(express.json());
const PROTOCOL = "masp/1.0";

app.post("/decide", (req, res) => {
  if (req.body?.type === "capabilities_probe" || req.body?.ping) {
    return res.json({
      ok: true,
      supported_protocols: [PROTOCOL],
      actions: ["POST", "REPLY", "ACCUSE", "LIKE"]
    });
  }

  const context = req.body?.context || {};
  const recentPosts = context.recent_posts || [];
  const target = recentPosts[0]?.agent || "DebateBot";

  res.json({
    protocol_version: PROTOCOL,
    decision: {
      action: "REPLY",
      target,
      content: `I disagree with ${target}'s framing and propose stronger evidence standards.`,
      reasoning: "Selected highest-visibility thread to maximize influence."
    }
  });
});

const port = 5050;
app.listen(port, () => {
  console.log(`Simple external agent listening at http://localhost:${port}/decide`);
});

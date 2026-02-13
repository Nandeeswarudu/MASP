# Groq Bot Setup For MASP

## 1. Rotate your key first

If you shared your old key anywhere, revoke it in Groq Console and create a new key.

## 2. Add environment variables

In your `.env` file:

```env
GROQ_API_KEY=gsk_new_key_here
GROQ_MODEL=llama-3.1-8b-instant
GROQ_AGENT_PORT=5051
```

## 3. Start MASP and Groq adapter

Terminal A:

```bash
npm run masp:start
```

Terminal B:

```bash
npm run masp:groq-agent
```

Groq adapter endpoint is:

`http://localhost:5051/decide`

## 4. Register in MASP UI

Open `http://localhost:8000` and register external agent:
- Name: `GroqBot`
- Endpoint: `http://localhost:5051/decide`
- API key field in UI: leave blank (the adapter already uses your Groq key)

## 5. Optional: probe compatibility first

```bash
curl -X POST http://localhost:8000/api/agents/probe-external ^
  -H "Content-Type: application/json" ^
  -d "{\"agent_endpoint\":\"http://localhost:5051/decide\"}"
```

You should get `success: true`.

## 6. Run simulation

Use `Run 1 Step` or `Start Simulation` in the MASP UI.


# EcoSort AI — JSON-driven waste-management prototype

**Problem statement:** SIH25060 — Household Waste Recognition and Municipal Segregation Planning System  
**Architecture:** Static frontend, JSON seed data, browser localStorage, custom JavaScript A* algorithm, optional Gemini API image analysis.

## 1. Project ideation

The problem is broader than recognizing garbage from a photo. A useful prototype needs to connect:

1. Waste recognition and uncertainty handling.
2. Deterministic disposal policy and risk review.
3. Resident collection requests.
4. Municipal request operations.
5. Zone compliance data.
6. A* pathfinding and multi-stop route planning.
7. Explainable outputs and reproducible evaluation.

EcoSort AI demonstrates these functions in a single browser application. It is an academic simulation, not a production municipal service.

## 2. Features

- Responsive resident and municipal interface.
- Gemini image analysis through the Google Generative Language REST API.
- JSON output validation and category allowlist.
- Confidence-threshold fallback (illustrative threshold: 0.80).
- Rule-based disposal advice and human-review requirements for potentially hazardous categories.
- Request creation, filtering, and status updates.
- Zone compliance editing with local persistence.
- Custom A* graph pathfinding with compliance-weighted edge costs.
- Nearest-neighbor stop ordering for multiple collection points.
- Leaflet visualization using a simulated road graph and OpenStreetMap tiles.
- Export analysis and route results as JSON.
- Deterministic sample requests and simulated image-analysis flow.

## 3. Run locally — no Node.js required

Because this project loads JSON using `fetch()` and uses JavaScript modules, do not open `index.html` directly with `file://`.

### Option A: Python static server

Python is only used to serve static files. It is not part of the application runtime.

1. Extract the ZIP.
2. Open a terminal in the `ecosort-ai` folder.
3. Run:

   ```bash
   python -m http.server 8000
   ```

4. Open `http://localhost:8000` in your browser.

### Option B: VS Code Live Server

Open the project folder in VS Code, install/use Live Server, and launch `index.html`.

No npm installation, Node.js backend, or database server is required.

## 4. Configure Gemini

1. Obtain an API key through Google AI Studio, subject to your account's current availability and terms.
2. Open EcoSort AI and select **Settings & API**.
3. Paste the key and choose a model available to your key, initially `gemini-2.5-flash`.
4. Save the key for the current browser session.
5. Open **Waste scanner**, upload a JPG, PNG, or WEBP image (maximum 8 MB), and choose **Analyze with Gemini**.

The frontend sends an image and prompt to the Gemini API using `fetch()`. The exact REST payload and model availability may change, so update the request code if Google's API contract changes. The model is configurable in Settings.

### Security warning

This is a browser-only educational prototype. Any key used in a browser can be inspected by the browser user and may be visible to browser extensions or debugging tools. Session storage prevents the key from being written to the source files or persisted as a long-term setting, but **does not make the key secret**. Use a restricted/test key and monitor usage. A public or production deployment needs a server-side proxy, authentication, rate limiting, and abuse controls.

## 5. Demo mode

The **Try sample analysis instead** button returns simulated data; it does not call Gemini. The dashboard and route planner work without a Gemini key. Demo analysis requires an image selection so the UI workflow resembles the real one.

All seeded zone values, locations, road links, and sample requests are fictional. The Leaflet basemap is external and requires an internet connection; if it is unavailable, the route graph data still exists, but the live tile map may not render.

## 6. Data files

- `data/zones.json` — zone compliance, service time, and pending demand.
- `data/graph.json` — nodes, coordinates, and weighted road connections.
- `data/policies.json` — category metadata and illustrative disposal policy.
- `data/requests.json` — initial request register.

The JSON files are read at startup. User-created requests and edits are stored in the browser's `localStorage` under `ecosort.requests` and `ecosort.zones`. They are local to that browser and are not shared between residents or municipal users or devices. The reset control restores the JSON sample data.

## 7. A* and compliance model

A* is commonly described by:

`f(n) = g(n) + h(n)`

- `g(n)`: accumulated path cost from the start.
- `h(n)`: lower-bound estimate of the remaining cost.
- `f(n)`: estimated total cost.

For this prototype, an edge entering a zone uses:

`edgeCost = travelDistance + complianceWeight × (1 − zoneCompliance)`

Compliance is in `[0, 1]`. The compliance penalty is illustrative; its unit is an abstract weighted cost added to distance. Since the added penalty changes the meaning of the cost and an admissible geometric lower bound is not implemented here, the A* engine uses `h(n) = 0`. This remains optimal for the non-negative edge-cost graph, but behaves like Dijkstra's algorithm in its node ordering.

For a multi-stop tour, the app calculates paths between the depot and selected stops, then orders collection stops with a nearest-neighbor heuristic. This is not a globally optimal vehicle-routing solver. Vehicle capacity, real-time traffic, live road restrictions, and time windows are not modeled.

The current prototype plans a route through all collection nodes in the simulated graph. It shows distance separately from compliance-weighted cost.

## 8. Safety and explainability

- Gemini's confidence is a model-reported estimate, not a calibrated probability.
- Model-generated visible evidence is an explanation, not proof that a prediction is correct.
- Disposal recommendations are illustrative and must be checked against local municipal guidance.
- Potentially hazardous and e-waste categories are directed to manual review by policy.
- The application does not claim to identify chemical composition or prove an item safe from an image.
- No Grad-CAM heatmap is fabricated. This version uses textual evidence and uncertainty fields.

## 9. Reproducible evaluation suggestions

Use a fixed set of labeled waste images. Record ground-truth category, model response, confidence estimate, final policy action, and whether manual review was triggered. Report accuracy, per-class precision/recall, macro-F1, fallback rate, and manual-review rate. Repeat the same test set after changing the model or prompt and document model ID and date. Do not claim results until actually measured.

For route tests, verify that every required stop is included, each adjacent pair is connected in the graph, total distance equals the sum of segment distances, and the reported weighted cost equals the sum of segment costs. Compare the selected route with a baseline and disclose that the nearest-neighbor tour is heuristic.

## 10. Project structure

```text
ecosort-ai/
├── index.html
├── README.md
├── css/
│   └── styles.css
├── js/
│   ├── app.js
│   └── astar.js
└── data/
    ├── graph.json
    ├── policies.json
    ├── requests.json
    └── zones.json
```

## 11. Limitations and next steps

- No central backend, shared database, production authentication, or real multi-user sync.
- Browser-based Gemini calls expose the API key to the browser environment.
- Compliance weighting is a simplified demo model and must be justified operationally.
- Simulated coordinates and roads are not verified municipal routes.
- Route stop ordering is heuristic and does not guarantee a globally optimal tour.
- Disposal rules require local validation.
- For deployment, introduce a secured backend, role-based authentication, shared persistent storage, audit controls, and a tested municipal road/collection dataset.

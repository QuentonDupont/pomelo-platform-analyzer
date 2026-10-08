"use client";

import D1Scorecard from "./decisions/D1Scorecard";
import D2Opportunities from "./decisions/D2Opportunities";
import D3Gap from "./decisions/D3Gap";
import D4Landing from "./decisions/D4Landing";
import D5Audience from "./decisions/D5Audience";
import D6Vitals from "./decisions/D6Vitals";
import D7AppHealth from "./decisions/D7AppHealth";
import D8Delivery from "./decisions/D8Delivery";
import D9DecisionLog from "./decisions/D9DecisionLog";
import D10Alerts from "./decisions/D10Alerts";
import DataQuality from "./DataQuality";
import Funnel from "./Funnel";
import Releases from "./Releases";
import type { Filters, PanelProps } from "./types";

const DECISION_NAV: [string, string][] = [
  ["panel-alerts", "D10 Alerts"],
  ["panel-d1", "D1 Scorecard"],
  ["panel-d2", "D2 Opportunities"],
  ["panel-d3", "D3 Web vs App"],
  ["panel-d4", "D4 Landing loss"],
  ["panel-d5", "D5 Audience"],
  ["panel-d6", "D6 Speed"],
  ["panel-app-health", "D7 App health"],
  ["panel-releases-health", "D8 Delivery"],
  ["panel-decisions-log", "D9 Decision log"],
];

/** Routes the active tab to its panels. */
export default function Panels(props: PanelProps & { set: (p: Partial<Filters>) => void; reload: () => void }) {
  const { set, reload, ...p } = props;
  void set;
  switch (p.f.tab) {
    case "decisions":
      return (
        <div className="grid" id="panel-decisions">
          <nav className="subnav" aria-label="Decision panels">
            {DECISION_NAV.map(([id, label]) => (
              <a key={id} href={`#${id}`}>
                {label}
              </a>
            ))}
          </nav>
          <D10Alerts {...p} onChange={reload} />
          <D1Scorecard {...p} />
          <D2Opportunities {...p} />
          <D3Gap {...p} />
          <D4Landing {...p} />
          <D5Audience {...p} />
          <D6Vitals {...p} />
          <D7AppHealth {...p} />
          <D8Delivery {...p} />
          <D9DecisionLog {...p} onChange={reload} />
        </div>
      );
    case "overview":
      return <Funnel {...p} />;
    case "releases":
      return <Releases {...p} />;
    case "quality":
      return <DataQuality {...p} />;
  }
}

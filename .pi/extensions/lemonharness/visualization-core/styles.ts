/**
 * Embedded CSS styles for LemonHarness HTML execution report.
 */

export const HTML_STYLES = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #f5f7fa; color: #1a1a2e; line-height: 1.6; padding: 20px;
  }
  .container { max-width: 1100px; margin: 0 auto; }
  h1 { font-size: 1.6rem; margin-bottom: 4px; display: flex; align-items: center; gap: 8px; }
  .subtitle { color: #666; font-size: 0.9rem; margin-bottom: 20px; }
  .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .summary-card { background: #fff; border-radius: 10px; padding: 14px 18px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); border-left: 4px solid #ccc; }
  .summary-card .label { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; color: #888; }
  .summary-card .value { font-size: 1.3rem; font-weight: 600; margin-top: 2px; }
  .summary-card .sub { font-size: 0.8rem; color: #888; }
  .card-phase { border-left-color: #1a73e8; }
  .card-budget { border-left-color: #e67e22; }
  .card-calls { border-left-color: #27ae60; }
  .card-errors { border-left-color: #e74c3c; }
  .card-validations { border-left-color: #8e44ad; }
  .budget-section { background: #fff; border-radius: 10px; padding: 18px; margin-bottom: 20px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
  .budget-header { display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 8px; }
  .budget-bar { height: 24px; background: #e9ecef; border-radius: 12px; overflow: hidden; position: relative; }
  .budget-fill { height: 100%; border-radius: 12px; background: linear-gradient(90deg, #1a73e8 0%, #e67e22 30%, #27ae60 60%, #8e44ad 90%); transition: width 0.5s ease; }
  .budget-bar .label-overlay { position: absolute; top: 0; left: 0; right: 0; bottom: 0; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 600; color: #333; }
  .budget-markers { position: relative; height: 10px; margin-top: 4px; }
  .budget-marker { position: absolute; top: 0; width: 2px; height: 10px; background: #333; transform: translateX(-1px); }
  .budget-marker-label { position: absolute; top: 12px; font-size: 0.65rem; color: #888; transform: translateX(-50%); }
  .timeline-section { background: #fff; border-radius: 10px; padding: 18px; margin-bottom: 20px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
  .timeline-section h2 { font-size: 1rem; margin-bottom: 12px; }
  .timeline-svg { width: 100%; height: auto; }
  .tl-tooltip { position: absolute; background: #1a1a2e; color: #fff; padding: 6px 10px; border-radius: 6px; font-size: 0.75rem; pointer-events: none; white-space: nowrap; z-index: 10; opacity: 0; transition: opacity 0.15s; }
  .legend { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 12px; padding-top: 12px; border-top: 1px solid #eee; }
  .legend-item { display: flex; align-items: center; gap: 6px; font-size: 0.8rem; color: #555; }
  .legend-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
  .legend-diamond { width: 10px; height: 10px; display: inline-block; transform: rotate(45deg); border-radius: 2px; }
  .events-section { background: #fff; border-radius: 10px; padding: 18px; margin-bottom: 20px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
  .events-section h2 { font-size: 1rem; margin-bottom: 12px; }
  .event-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  .event-table th { text-align: left; padding: 6px 10px; border-bottom: 2px solid #eee; color: #888; font-weight: 600; font-size: 0.75rem; text-transform: uppercase; }
  .event-table td { padding: 6px 10px; border-bottom: 1px solid #f0f0f0; vertical-align: top; }
  .event-table tr:hover { background: #f8f9fa; }
  .event-phase { display: inline-block; font-size: 0.65rem; padding: 1px 6px; border-radius: 4px; color: #fff; font-weight: 600; }
  .badge-success, .badge-pass { display: inline-block; background: #27ae60; color: #fff; font-size: 0.65rem; padding: 1px 6px; border-radius: 4px; }
  .badge-error, .badge-fail { display: inline-block; background: #e74c3c; color: #fff; font-size: 0.65rem; padding: 1px 6px; border-radius: 4px; }
  .event-time { color: #999; font-size: 0.75rem; font-family: 'SF Mono', 'Fira Code', monospace; white-space: nowrap; }
  .footer { text-align: center; color: #aaa; font-size: 0.75rem; padding: 20px; }
  .footer a { color: #1a73e8; text-decoration: none; }
`;

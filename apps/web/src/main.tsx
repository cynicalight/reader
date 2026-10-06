import ReactDOM from "react-dom/client";
import { configureAPI } from "@reader/api";
import { App } from "./App";
import "./style.css";
import { installScrollbars } from "./scrollbars";
const removeScrollbars = installScrollbars(document);
if (import.meta.hot) import.meta.hot.dispose(removeScrollbars);
const token =
  new URLSearchParams(location.hash.slice(1)).get("token") ||
  sessionStorage.getItem("reader-session") ||
  "";
if (token) {
  sessionStorage.setItem("reader-session", token);
  history.replaceState(null, "", location.pathname + location.search);
}
configureAPI(token);
const root = ReactDOM.createRoot(document.getElementById("root")!);
if (import.meta.env.DEV && location.pathname === "/__streaming-benchmark") {
  void import("./chat/StreamingBenchmark").then(({ default: Benchmark }) =>
    root.render(<Benchmark />),
  );
} else if (import.meta.env.DEV && location.pathname === "/__streaming") {
  void import("./chat/StreamingPreview").then(({ default: Preview }) =>
    root.render(<Preview />),
  );
} else if (import.meta.env.DEV && location.pathname === "/__formula-caption") {
  void import("./translation/FormulaCaptionPreview").then(
    ({ default: Preview }) => root.render(<Preview />),
  );
} else root.render(<App />);

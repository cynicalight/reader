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
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);

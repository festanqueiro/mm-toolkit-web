import { mount } from "svelte";
import App from "./ui/App.svelte";
import { listenForInstall, listenForLaunches, registerPwa } from "./ui/pwa.svelte";
import "./ui/theme.css";

const target = document.getElementById("app");
if (!target) throw new Error("Missing #app mount point");

const app = mount(App, { target });

listenForLaunches();
listenForInstall();
if (import.meta.env.PROD) void registerPwa();

export default app;

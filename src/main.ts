import { mount } from "svelte";
import App from "./ui/App.svelte";
import "./ui/theme.css";

const target = document.getElementById("app");
if (!target) throw new Error("Missing #app mount point");

export default mount(App, { target });

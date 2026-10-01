<script lang="ts">
  import type { ConflictPolicy } from "../../engine/naming";
  import { safeFilename } from "../../engine/naming";
  import { CLIP_TEMPLATE_ERROR, formatTemplate, PROMO_TEMPLATE_ERROR } from "../../engine/template";
  import { fileRefFromHandle, forgetRef, handleFor, queryPermission, requestPermission } from "../../io/file-ref";
  import { normaliseNaming, type Theme } from "../../storage/settings";
  import PageHeader from "../components/PageHeader.svelte";
  import Section from "../components/Section.svelte";
  import { app, updateSetting } from "../state.svelte";

  const settings = $derived(app.settings);
  const tier1 = $derived(app.capabilities?.directoryPicker ?? false);

  // ---- Default export folder (Tier 1 only) ----
  let folderPermission = $state<PermissionState | "none">("none");

  $effect(() => {
    const ref = settings["general/default_output"];
    if (!ref) {
      folderPermission = "none";
      return;
    }
    handleFor(ref).then(async (handle) => {
      folderPermission = handle ? await queryPermission(handle, "readwrite") : "none";
    });
  });

  async function chooseFolder() {
    try {
      const handle = await showDirectoryPicker({ id: "mm-default-export", mode: "readwrite" });
      const previous = settings["general/default_output"];
      await updateSetting("general/default_output", await fileRefFromHandle(handle));
      await forgetRef(previous);
    } catch (error) {
      if ((error as DOMException)?.name !== "AbortError") throw error;
    }
  }

  async function reallowFolder() {
    const handle = await handleFor(settings["general/default_output"]);
    if (handle && (await requestPermission(handle, "readwrite"))) folderPermission = "granted";
  }

  async function clearFolder() {
    await forgetRef(settings["general/default_output"]);
    await updateSetting("general/default_output", null);
  }

  // ---- Notifications ----
  let notificationsBlocked = $state(typeof Notification !== "undefined" && Notification.permission === "denied");

  async function toggleNotifications(event: Event) {
    const checked = (event.currentTarget as HTMLInputElement).checked;
    if (checked && typeof Notification !== "undefined" && Notification.permission === "default") {
      notificationsBlocked = (await Notification.requestPermission()) === "denied";
    }
    await updateSetting("general/notify_finished", checked);
  }

  // ---- Naming templates ----
  let promoDraft = $state("");
  let clipDraft = $state("");
  $effect(() => {
    promoDraft = settings["general/promo_naming"];
    clipDraft = settings["general/clip_naming"];
  });

  function example(template: string, fields: Record<string, string | number>, ext: string, error: string) {
    try {
      return { ok: true, text: `e.g. ${safeFilename(formatTemplate(template, fields))}.${ext}` };
    } catch {
      return { ok: false, text: error };
    }
  }
  const promoExample = $derived(
    example(normaliseNaming("general/promo_naming", promoDraft), { track: "My Song", number: 1 }, "mp4", PROMO_TEMPLATE_ERROR),
  );
  const clipExample = $derived(
    example(normaliseNaming("general/clip_naming", clipDraft), { source: "Live Set", title: "Intro", number: 1 }, "wav", CLIP_TEMPLATE_ERROR),
  );

  function commitNaming(key: "general/promo_naming" | "general/clip_naming", value: string) {
    const normalised = normaliseNaming(key, value);
    if (key === "general/promo_naming") promoDraft = normalised;
    else clipDraft = normalised;
    if (normalised !== settings[key]) updateSetting(key, normalised);
  }

  const onEnter = (commit: () => void) => (event: KeyboardEvent) => {
    if (event.key === "Enter") commit();
  };
</script>

<PageHeader title="Settings" subtitle="Defaults shared by all Media Tools features." />

<div class="stack">
  <Section title="General">
    <div class="form">
      <span class="label" id="default-output-label">Default Folder for Export</span>
      <div class="field">
        {#if tier1}
          <div class="row">
            <input
              class="path"
              readonly
              aria-labelledby="default-output-label"
              placeholder="Nothing selected"
              value={settings["general/default_output"]?.name ?? ""}
            />
            <button type="button" onclick={chooseFolder}>Choose…</button>
            {#if settings["general/default_output"]}
              <button type="button" class="secondary" onclick={clearFolder}>Clear</button>
            {/if}
          </div>
          <p class="status" data-testid="default-output-status">
            {#if folderPermission === "granted"}
              ✓ Default export folder is writable.
            {:else if folderPermission === "prompt" && settings["general/default_output"]}
              <button type="button" class="link" onclick={reallowFolder}>
                Click to re-allow access to "{settings["general/default_output"]?.name}".
              </button>
            {:else}
              Optional: choose a writable folder to prefill exports.
            {/if}
          </p>
        {:else}
          <p class="status" data-testid="default-output-status">
            Your browser saves exports to its Downloads folder. Batches can be downloaded as a ZIP.
          </p>
        {/if}
      </div>

      <span class="label">Notifications</span>
      <div class="field">
        <label class="check">
          <input type="checkbox" checked={settings["general/notify_finished"]} onchange={toggleNotifications} />
          Send a notification when processing finishes
        </label>
        {#if notificationsBlocked && settings["general/notify_finished"]}
          <p class="status warn">Notifications are blocked for this site in your browser settings.</p>
        {/if}
      </div>

      <label class="label" for="promo-naming">Generated video filename</label>
      <div class="field">
        <input
          id="promo-naming"
          class="text"
          bind:value={promoDraft}
          onblur={() => commitNaming("general/promo_naming", promoDraft)}
          onkeydown={onEnter(() => commitNaming("general/promo_naming", promoDraft))}
          aria-describedby="promo-naming-example"
        />
        <p id="promo-naming-example" class="status" class:warn={!promoExample.ok}>{promoExample.text}</p>
      </div>

      <label class="label" for="clip-naming">Clip filename</label>
      <div class="field">
        <input
          id="clip-naming"
          class="text"
          bind:value={clipDraft}
          onblur={() => commitNaming("general/clip_naming", clipDraft)}
          onkeydown={onEnter(() => commitNaming("general/clip_naming", clipDraft))}
          aria-describedby="clip-naming-example"
        />
        <p id="clip-naming-example" class="status" class:warn={!clipExample.ok}>{clipExample.text}</p>
      </div>

      {#if tier1}
        <label class="label" for="conflict-policy">Existing files</label>
        <div class="field">
          <select
            id="conflict-policy"
            value={settings["general/conflict_policy"]}
            onchange={(e) => updateSetting("general/conflict_policy", e.currentTarget.value as ConflictPolicy)}
          >
            <option value="rename">Create a numbered copy</option>
            <option value="overwrite">Overwrite</option>
            <option value="skip">Skip</option>
          </select>
        </div>
      {/if}
    </div>
  </Section>

  <Section title="Browser">
    <div class="form">
      <span class="label">Batches</span>
      <label class="check field">
        <input
          type="checkbox"
          checked={settings["web/zip_batches"]}
          onchange={(e) => updateSetting("web/zip_batches", e.currentTarget.checked)}
        />
        Download batches as a single ZIP
      </label>

      <span class="label">History</span>
      <label class="check field">
        <input
          type="checkbox"
          checked={settings["web/keep_output_copies"]}
          onchange={(e) => updateSetting("web/keep_output_copies", e.currentTarget.checked)}
        />
        Keep copies of outputs for History previews (uses browser storage)
      </label>

      <span class="label">Large files</span>
      <label class="check field">
        <input
          type="checkbox"
          checked={settings["web/wasm_large_inputs"]}
          onchange={(e) => updateSetting("web/wasm_large_inputs", e.currentTarget.checked)}
        />
        Allow conversions of very large files on the slower fallback path (may run out of memory)
      </label>

      <label class="label" for="theme">Theme</label>
      <div class="field">
        <select id="theme" value={settings["web/theme"]} onchange={(e) => updateSetting("web/theme", e.currentTarget.value as Theme)}>
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </div>
    </div>
  </Section>
</div>

<style>
  .stack {
    display: grid;
    gap: 14px;
    max-width: 860px;
  }
  .form {
    display: grid;
    grid-template-columns: minmax(160px, 220px) 1fr;
    gap: 16px 18px;
    align-items: start;
  }
  @media (max-width: 640px) {
    .form {
      grid-template-columns: 1fr;
      gap: 6px;
    }
    .form > .field {
      margin-bottom: 12px;
    }
  }
  .label {
    padding-top: 9px;
    font-weight: 600;
  }
  .field {
    min-width: 0;
  }
  .row {
    display: flex;
    gap: 8px;
  }
  input.path,
  input.text,
  select {
    min-height: 40px;
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--text);
    font: inherit;
  }
  input.path,
  input.text {
    flex: 1;
    width: 100%;
    min-width: 0;
  }
  select {
    min-width: 260px;
  }
  button {
    min-height: 40px;
    padding: 0 14px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface-alt);
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }
  button.link {
    min-height: 0;
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    text-decoration: underline;
  }
  .check {
    display: flex;
    gap: 8px;
    align-items: center;
    padding-top: 9px;
  }
  .status {
    margin: 6px 0 0;
    color: var(--text-muted);
    font-size: 0.92rem;
  }
  .warn {
    color: var(--warn);
  }
</style>

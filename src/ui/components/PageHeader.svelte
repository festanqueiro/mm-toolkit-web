<script lang="ts">
  let { title, subtitle = "" }: { title: string; subtitle?: string } = $props();
</script>

<header>
  <h1>{title}</h1>
  {#if subtitle}<p>{subtitle}</p>{/if}
</header>

<style>
  header {
    margin-bottom: 16px;
  }
  h1 {
    margin: 0 0 4px;
    font-size: 1.6rem;
  }
  p {
    margin: 0;
  }
</style>

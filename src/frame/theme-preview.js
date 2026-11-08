// a little lattice, in a theme: its projects down the side, a pattern open
// beside them. every theme's rules are [theme="…"], so it's drawn in one by
// saying so. its words are in the theme's fonts, so changing those shows here
import html from "solid-js/html";

export function ThemePreview(props) {
  return html`<div class="lattice-mini" theme=${() => props.id} aria-hidden="true">
    <div class="lattice-mini-top"><i></i><i></i></div>
    <div class="lattice-mini-body">
      <div class="lattice-mini-side">
        <b>projects</b>
        <span data-current>scarf</span>
        <span>mittens</span>
      </div>
      <div class="lattice-mini-main">
        <div class="lattice-mini-tabs"><span>scarf.k</span></div>
        <div class="lattice-mini-tools"><span class="lattice-mini-build">build</span></div>
        <div class="lattice-mini-code">
          <div><s>1</s><span class="k">for</span> n = <span class="n">0</span>..<span class="n">8</span></div>
          <div><s>2</s>  knit(<span class="t">"f"</span>, n)</div>
          <div><s>3</s><span class="c">// rib</span></div>
        </div>
      </div>
    </div>
  </div>`;
}

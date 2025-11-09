/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {LitElement, css, html} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {Analyser} from './analyser';

// All images are now from a public CDN. These are direct links to the images.
const MOUTH_CLOSED_SRC = `https://i.postimg.cc/Dycq2xc4/close-Mouth-Goblin.png`;
const MOUTH_SLIGHTLY_OPEN_SRC =
  `https://i.postimg.cc/CMchSDqw/slight-Open-Goblin.png`;
const MOUTH_WIDE_OPEN_SRC =
  `https://i.postimg.cc/Prcd8jy6/wide-Open-Goblin.png`;

/**
 * A visualizer that shows an animated goblin character whose mouth
 * syncs with the AI's speech.
 */
@customElement('goblin-visual')
export class GoblinVisual extends LitElement {
  private outputAnalyser?: Analyser;

  @property({attribute: false})
  set outputNode(node: AudioNode | undefined) {
    if (node) {
      this.outputAnalyser = new Analyser(node);
    }
  }

  @state()
  private currentImageSrc = MOUTH_CLOSED_SRC;
  private lastTalkTime = 0;
  private readonly MOUTH_CLOSE_DELAY = 500; // 500ms delay

  static styles = css`
    :host {
      width: 100%;
      height: 100%;
      display: flex;
      justify-content: center;
      align-items: center;
      position: absolute;
      inset: 0;
      transition: transform 0.5s ease-in-out;
      /*
       * Set the z-index to 1 to ensure the goblin visual is rendered
       * behind the UI controls, which have a z-index of 10.
      */
      z-index: 1;
    }

    :host(.coding-active) {
      transform: translateY(-20vh);
    }

    img {
      max-width: 90vw;
      max-height: 70vh;
      object-fit: contain;
      transition: transform 0.1s ease-out;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    this.animation();
  }

  private animation() {
    requestAnimationFrame(() => this.animation());

    if (!this.outputAnalyser) {
      this.currentImageSrc = MOUTH_CLOSED_SRC;
      return;
    }

    this.outputAnalyser.update();
    // Use a frequency bin that's typically active during human speech.
    const volume = this.outputAnalyser.data[1] ?? 0;
    const now = performance.now();

    // Define thresholds for switching mouth images.
    const SILENCE_THRESHOLD = 10;
    const TALKING_THRESHOLD = 140;

    // Check if the AI is currently making sound.
    if (volume > SILENCE_THRESHOLD) {
      // If so, update the timestamp of the last time it spoke.
      this.lastTalkTime = now;

      // Set the appropriate open-mouth image based on volume.
      if (volume > TALKING_THRESHOLD) {
        this.currentImageSrc = MOUTH_WIDE_OPEN_SRC;
      } else {
        this.currentImageSrc = MOUTH_SLIGHTLY_OPEN_SRC;
      }
    } else {
      // If the AI is silent, check if enough time has passed to close the mouth.
      if (now - this.lastTalkTime > this.MOUTH_CLOSE_DELAY) {
        this.currentImageSrc = MOUTH_CLOSED_SRC;
      }
      // Otherwise, do nothing and keep the mouth open for the duration of the delay.
    }

    // Add a subtle bounce effect for a more lively feel.
    const imgElement = this.shadowRoot?.querySelector('img');
    if (imgElement) {
      const scale = 1 + (volume / 255) * 0.03;
      imgElement.style.transform = `scale(${scale})`;
    }
  }

  render() {
    return html`<img
      src=${this.currentImageSrc}
      alt="Animated Goblin Interviewer" />`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'goblin-visual': GoblinVisual;
  }
}

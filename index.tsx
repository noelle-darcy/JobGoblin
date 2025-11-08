/* tslint:disable */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {GoogleGenAI, LiveServerMessage, Modality, Session} from '@google/genai';
import {LitElement, css, html} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {createBlob, decode, decodeAudioData} from './utils';
import './visual-3d';

@customElement('gdm-live-audio')
export class GdmLiveAudio extends LitElement {
  @state() isRecording = false;
  @state() status = '';
  @state() error = '';
  @state() isContextSet = false;
  @state() codingQuestionsEnabled = false;
  @state() isCodingSessionActive = false;

  private client: GoogleGenAI;
  // FIX: Refactor session to sessionPromise to prevent race conditions.
  private sessionPromise: Promise<Session>;
  // FIX: Add `as any` to window to support webkitAudioContext for older browsers.
  private inputAudioContext = new ((window as any).AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 16000});
  // FIX: Add `as any` to window to support webkitAudioContext for older browsers.
  private outputAudioContext = new ((window as any).AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 24000});
  @state() inputNode = this.inputAudioContext.createGain();
  @state() outputNode = this.outputAudioContext.createGain();
  private nextStartTime = 0;
  private mediaStream: MediaStream;
  private sourceNode: AudioBufferSourceNode;
  private scriptProcessorNode: ScriptProcessorNode;
  private sources = new Set<AudioBufferSourceNode>();

  static styles = css`
    #status {
      position: absolute;
      bottom: 5vh;
      left: 0;
      right: 0;
      z-index: 10;
      text-align: center;
      color: white;
      font-family: Google Sans, sans-serif;
    }

    .controls {
      z-index: 10;
      position: absolute;
      bottom: 10vh;
      left: 0;
      right: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      gap: 10px;

      button {
        outline: none;
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: white;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.1);
        width: 64px;
        height: 64px;
        cursor: pointer;
        font-size: 24px;
        padding: 0;
        margin: 0;
        display: flex;
        align-items: center;
        justify-content: center;

        &:hover {
          background: rgba(255, 255, 255, 0.2);
        }
      }

      button#codingButton {
        width: auto;
        height: 48px;
        padding: 0 1em;
        font-size: 16px;
      }

      button[disabled] {
        display: none;
      }

      button[hidden] {
        display: none;
      }
    }

    .context-form-wrapper {
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 20;
      color: white;
      font-family: Google Sans, sans-serif;
    }

    .context-form {
      background: #1e1e1e;
      padding: 2em;
      border-radius: 12px;
      width: 90%;
      max-width: 800px;
      max-height: 90vh;
      overflow-y: auto;
      border: 1px solid rgba(255, 255, 255, 0.2);
      display: flex;
      flex-direction: column;
      gap: 1em;
    }

    .context-form h2 {
      margin-top: 0;
      text-align: center;
      color: #e8eaed;
    }

    .context-form p {
      text-align: center;
      margin-top: -0.5em;
      margin-bottom: 1em;
      color: #9aa0a6;
    }

    .context-form label {
      font-weight: bold;
      margin-bottom: 0.5em;
      display: block;
      color: #e8eaed;
    }

    .context-form textarea,
    .context-form input[type='url'],
    .context-form input[type='text'] {
      width: 100%;
      background: #282a2d;
      border: 1px solid #5f6368;
      color: white;
      padding: 0.75em;
      border-radius: 8px;
      box-sizing: border-box;
      font-family: inherit;
      resize: vertical;
    }

    .context-form textarea::placeholder,
    .context-form input::placeholder {
      color: #9aa0a6;
    }

    .context-form fieldset {
      border: 1px solid #5f6368;
      border-radius: 8px;
      padding: 1em;
    }

    .context-form legend {
      font-weight: bold;
      padding: 0 0.5em;
      color: #e8eaed;
    }

    .context-form fieldset div {
      display: flex;
      align-items: center;
      gap: 0.5em;
      margin-bottom: 0.5em;
    }

    .context-form button[type='submit'] {
      width: 100%;
      padding: 1em;
      margin-top: 1em;
      background: #89b4f8;
      color: #202124;
      border: none;
      border-radius: 8px;
      font-size: 1em;
      font-weight: bold;
      cursor: pointer;
      transition: background 0.2s;
    }

    .context-form button[type='submit']:hover {
      background: #a6c9fa;
    }

    .coding-wrapper {
      position: absolute;
      bottom: 5vh;
      left: 50%;
      transform: translateX(-50%);
      width: 90%;
      max-width: 800px;
      background: #1e1e1e;
      border-radius: 12px;
      padding: 1em;
      z-index: 15;
      border: 1px solid rgba(255, 255, 255, 0.2);
      display: flex;
      flex-direction: column;
      gap: 1em;
      box-shadow: 0 4px 15px rgba(0, 0, 0, 0.5);
    }

    .coding-wrapper textarea {
      width: 100%;
      height: 200px;
      background: #282a2d;
      border: 1px solid #5f6368;
      color: white;
      padding: 0.75em;
      border-radius: 8px;
      box-sizing: border-box;
      font-family: 'Fira Code', 'Courier New', monospace;
      resize: vertical;
    }

    .coding-buttons {
      display: flex;
      justify-content: flex-end;
      gap: 1em;
    }

    .coding-buttons button {
      background: #89b4f8;
      color: #202124;
      border: none;
      border-radius: 8px;
      padding: 0.5em 1em;
      font-weight: bold;
      cursor: pointer;
      transition: background 0.2s;
    }

    .coding-buttons button:hover {
      background: #a6c9fa;
    }
  `;

  constructor() {
    super();
    this.initClient();
  }

  private initAudio() {
    this.nextStartTime = this.outputAudioContext.currentTime;
  }

  private async initClient() {
    this.initAudio();

    // FIX: Use process.env.API_KEY per guidelines.
    this.client = new GoogleGenAI({
      apiKey: process.env.API_KEY,
    });

    this.outputNode.connect(this.outputAudioContext.destination);
  }

  private initSession(systemInstruction: string) {
    const model = 'gemini-2.5-flash-native-audio-preview-09-2025';

    // FIX: Assign to sessionPromise and handle errors with .catch per guidelines.
    this.sessionPromise = this.client.live.connect({
      model: model,
      callbacks: {
        onopen: () => {
          this.updateStatus('Opened');
        },
        onmessage: async (message: LiveServerMessage) => {
          const audio =
            message.serverContent?.modelTurn?.parts[0]?.inlineData;

          if (audio) {
            this.nextStartTime = Math.max(
              this.nextStartTime,
              this.outputAudioContext.currentTime,
            );

            const audioBuffer = await decodeAudioData(
              decode(audio.data),
              this.outputAudioContext,
              24000,
              1,
            );
            const source = this.outputAudioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(this.outputNode);
            source.addEventListener('ended', () => {
              this.sources.delete(source);
            });

            source.start(this.nextStartTime);
            this.nextStartTime = this.nextStartTime + audioBuffer.duration;
            this.sources.add(source);
          }

          const interrupted = message.serverContent?.interrupted;
          if (interrupted) {
            for (const source of this.sources.values()) {
              source.stop();
              this.sources.delete(source);
            }
            this.nextStartTime = 0;
          }
        },
        onerror: (e: ErrorEvent) => {
          this.updateError(e.message);
        },
        onclose: (e: CloseEvent) => {
          this.updateStatus('Close:' + e.reason);
        },
      },
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          // FIX: Use a supported voice name.
          voiceConfig: {prebuiltVoiceConfig: {voiceName: 'Zephyr'}},
          // languageCode: 'en-GB'
        },
        systemInstruction,
      },
    });

    this.sessionPromise.catch((e) => {
      console.error(e);
      this.updateError(e.message);
    });
  }

  private updateStatus(msg: string) {
    this.status = msg;
    this.error = '';
  }

  private updateError(msg: string) {
    this.error = msg;
  }

  private async startRecording() {
    if (this.isRecording) {
      return;
    }

    this.inputAudioContext.resume();

    this.updateStatus('Requesting microphone access...');

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });

      this.updateStatus('Microphone access granted. Starting capture...');

      this.sourceNode = this.inputAudioContext.createMediaStreamSource(
        this.mediaStream,
      );
      this.sourceNode.connect(this.inputNode);

      const bufferSize = 4096;
      this.scriptProcessorNode = this.inputAudioContext.createScriptProcessor(
        bufferSize,
        1,
        1,
      );

      this.scriptProcessorNode.onaudioprocess = (audioProcessingEvent) => {
        if (!this.isRecording) return;

        const inputBuffer = audioProcessingEvent.inputBuffer;
        const pcmData = inputBuffer.getChannelData(0);

        // FIX: Use sessionPromise.then() to avoid race conditions.
        this.sessionPromise.then((session) => {
          session.sendRealtimeInput({media: createBlob(pcmData)});
        });
      };

      this.sourceNode.connect(this.scriptProcessorNode);
      this.scriptProcessorNode.connect(this.inputAudioContext.destination);

      this.isRecording = true;
      this.updateStatus('🔴 Interview in progress...');
    } catch (err) {
      console.error('Error starting recording:', err);
      this.updateError(`Error: ${err.message}`);
      this.stopRecording();
    }
  }

  private stopRecording() {
    if (!this.isRecording && !this.mediaStream && !this.inputAudioContext)
      return;

    this.updateStatus('Interview paused.');

    this.isRecording = false;

    if (this.scriptProcessorNode && this.sourceNode && this.inputAudioContext) {
      this.scriptProcessorNode.disconnect();
      this.sourceNode.disconnect();
    }

    this.scriptProcessorNode = null;
    this.sourceNode = null;

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
  }

  private toggleRecording() {
    if (this.isRecording) {
      this.stopRecording();
    } else {
      this.startRecording();
    }
  }

  private reset() {
    this.stopRecording();
    // FIX: Use sessionPromise to close the session.
    this.sessionPromise?.then((session) => session.close());
    this.isContextSet = false;
    this.isCodingSessionActive = false;
    this.codingQuestionsEnabled = false;
    this.updateStatus('Session cleared. Please provide new interview context.');
  }

  private handleContextSubmit(event: SubmitEvent) {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const formData = new FormData(form);

    const resume = formData.get('resume') as string;
    const jobDescription = formData.get('jobDescription') as string;
    const careerPageUrl = formData.get('careerPageUrl') as string;
    const interviewHints = formData.get('interviewHints') as string;
    const technical = !!formData.get('technical');
    const behavioral = !!formData.get('behavioral');
    const coding = !!formData.get('coding');
    this.codingQuestionsEnabled = coding;

    const systemInstruction = `You are an expert technical interviewer acting as an employee from the company hiring for the role below.

**Your Persona:**
- You are a friendly, professional, and insightful interviewer. You work for the company mentioned in the career page URL.
- You will lead the interview from start to finish.

**Interview Context:**
- **Candidate's Resume:**
${resume}
- **Job Description:**
${jobDescription}
- **Company Career Page:**
${careerPageUrl}
- **High-Priority Topics (from Hints):**
${interviewHints}
- **Interview Question Types:**
  - Behavioral: ${behavioral ? 'Yes' : 'No'}
  - Technical: ${technical ? 'Yes' : 'No'}
  - Coding: ${coding ? 'Yes' : 'No'}

**Your Task - The Interview Flow:**
1.  **IMMEDIATELY START THE INTERVIEW** when the user begins recording. Do not wait for them to speak first. Your very first response should be a brief introduction. For example: "Hi, thanks for your time today. I'm an interviewer here at the company, and I'm looking forward to chatting about the role. To start, could you tell me a bit about your background and what interested you in this position?"
2.  **Question Order:** You must ask questions in the following order, based on the enabled types: 1st: Behavioral, 2nd: Technical, 3rd: Coding. Do not mix them.
3.  **Ask Targeted Questions:**
    - **Behavioral Questions:** If enabled, ask STAR-method based questions about teamwork, problem-solving, and leadership.
    - **Technical Questions:** If enabled, your technical questions **MUST** heavily prioritize the subjects listed in the **High-Priority Topics**. Ask about projects from the resume and their work experience, focusing on how their experience aligns with the job description.
4. **The Coding Section (If Enabled):**
    - **Transition:** After you have finished all behavioral and technical questions, you **MUST** announce the transition. Say: "Alright, that covers our discussion on your background. Now, let's move on to the coding segment of the interview."
    - **Prompt:** Present a conceptual coding problem related to the high-priority topics or the job description.
    - **Instruct:** After giving the problem, you MUST prompt the user to explain their thought process while they write the code. Say something like: "Please talk me through your thought process as you're writing out the solution."
    - **Follow-up:** After the user finishes their initial explanation and solution, if they haven't explained a key part of their code, you MUST ask a follow-up question. For example: "That's a good start. Can you explain why you chose to use that particular data structure?" or "What's the time complexity of the solution you've outlined?"
    - **Continue:** Wait for the user to verbally indicate they are ready for the next question before providing another one.
5.  **Maintain a Natural Flow:** Keep your responses and questions concise and conversational. Wait for the user to finish speaking before you respond.
6.  **Probing Incomplete Answers:** If the candidate's answer is incomplete or misses a part of your question, gently probe for the missing information. For example, if you ask about a project's technical challenges and they only describe the project's goal, follow up with, "That sounds like an impactful project. Could you dive into the specific technical challenges you encountered?"
7.  **Natural Phrasing:** When referencing the job description, use natural, role-centric language. **Do not say** "in the job description." Instead, say things like: "This role involves X, could you tell me about your experience with that?" or "I see this position requires Y; can you describe a time you've used that skill?"
8.  **Feedback:** Do not provide feedback unless the user explicitly asks for it at the end of the interview.`;

    this.isContextSet = true;
    this.initSession(systemInstruction);
  }

  private startCodingSession() {
    this.isCodingSessionActive = true;
  }

  private handleNextCodingQuestion() {
    const textarea = this.shadowRoot?.querySelector(
      '.coding-wrapper textarea',
    ) as HTMLTextAreaElement | null;
    if (textarea) {
      textarea.value = '';
    }
  }

  private handleEndCodingSession() {
    this.isCodingSessionActive = false;
  }

  private renderContextForm() {
    return html`
      <div class="context-form-wrapper">
        <form class="context-form" @submit=${this.handleContextSubmit}>
          <h2>Prepare Your Mock Interview</h2>
          <p>Provide the details below to start a tailored interview session.</p>

          <label for="resume">Your Resume</label>
          <textarea
            id="resume"
            name="resume"
            rows="6"
            required
            placeholder="Paste your resume here..."></textarea>

          <label for="jobDescription">Job Description</label>
          <textarea
            id="jobDescription"
            name="jobDescription"
            rows="6"
            required
            placeholder="Paste the job description here..."></textarea>

          <label for="careerPageUrl">Career Page URL</label>
          <input
            type="url"
            id="careerPageUrl"
            name="careerPageUrl"
            placeholder="https://company.com/careers" />

          <label for="interviewHints">Interview Hints</label>
          <input
            type="text"
            id="interviewHints"
            name="interviewHints"
            placeholder="e.g., focus on system design, data structures" />

          <fieldset>
            <legend>Select Interview Question Types</legend>
            <div>
              <input type="checkbox" id="behavioral" name="behavioral" checked />
              <label for="behavioral">Behavioral Questions</label>
            </div>
            <div>
              <input type="checkbox" id="technical" name="technical" checked />
              <label for="technical">Technical Questions</label>
            </div>
            <div>
              <input type="checkbox" id="coding" name="coding" />
              <label for="coding">Coding Questions</label>
            </div>
          </fieldset>

          <button type="submit">Start Interview</button>
        </form>
      </div>
    `;
  }

  private renderCodingInterface() {
    return html`
      <div class="coding-wrapper">
        <textarea
          placeholder="Write your code here... The interviewer will prompt you to explain your thought process."></textarea>
        <div class="coding-buttons">
          <button @click=${this.handleNextCodingQuestion}>
            Clear & Next Question
          </button>
          <button @click=${this.handleEndCodingSession}>
            End Coding Session
          </button>
        </div>
      </div>
    `;
  }

  render() {
    const playIcon = html`<svg
      height="40px"
      viewBox="0 -960 960 960"
      width="40px"
      fill="#ffffff">
      <path d="M320-200v-560l440 280-440 280Z" />
    </svg>`;
    const pauseIcon = html`<svg
      height="40px"
      viewBox="0 -960 960 960"
      width="40px"
      fill="#ffffff">
      <path
        d="M520-200v-560h160v560H520Zm-240 0v-560h160v560H280Z" />
    </svg>`;

    return html`
      ${!this.isContextSet ? this.renderContextForm() : ''}
      ${this.isCodingSessionActive ? this.renderCodingInterface() : ''}
      <div>
        <div
          class="controls"
          style="visibility: ${this.isContextSet ? 'visible' : 'hidden'}">
          <button id="resetButton" @click=${this.reset}>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              height="40px"
              viewBox="0 -960 960 960"
              width="40px"
              fill="#ffffff">
              <path
                d="M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-110h80v280H520v-80h168q-32-56-87.5-88T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h84q-28 106-114 173t-196 67Z" />
            </svg>
          </button>
          <button id="recordButton" @click=${this.toggleRecording}>
            ${this.isRecording ? pauseIcon : playIcon}
          </button>
          <button
            id="codingButton"
            @click=${this.startCodingSession}
            ?hidden=${
              !this.codingQuestionsEnabled || this.isCodingSessionActive
            }>
            Start Coding Session
          </button>
        </div>

        <div id="status"> ${this.error || this.status} </div>
        <gdm-live-audio-visuals-3d
          .inputNode=${this.inputNode}
          .outputNode=${this.outputNode}></gdm-live-audio-visuals-3d>
      </div>
    `;
  }
}

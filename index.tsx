import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Chat } from '@google/genai';
import { marked } from 'marked';

// TypeScript interfaces for the Web Speech API
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}
interface SpeechRecognitionResultList {
  [index: number]: SpeechRecognitionResult;
  length: number;
}
interface SpeechRecognitionResult {
  [index: number]: SpeechRecognitionAlternative;
  isFinal: boolean;
  length: number;
}
interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}
declare global {
    interface Window {
        SpeechRecognition: any;
        webkitSpeechRecognition: any;
        mermaid: any;
    }
    const pdfjsLib: any;
}

// Test related interfaces
interface TestQuestion {
    question: string;
    options: string[];
    correctAnswer: string;
    questionNumber: number;
}

interface TestState {
    status: 'idle' | 'taking' | 'finished';
    questions: TestQuestion[];
    userAnswers: { [key: number]: string };
    currentQuestionIndex: number;
    score: number;
    suggestions: string;
    suggestionsLoading: boolean;
}

interface VideoState {
    status: 'idle' | 'loading' | 'success' | 'error';
    url: string | null;
    loadingMessage: string;
}

interface ChatMessage {
    role: 'user' | 'model';
    text: string;
}


const Flashcard: React.FC<{ question: string; answer: string }> = ({ question, answer }) => {
  const [isFlipped, setIsFlipped] = useState(false);
  return (
    <div className="flashcard" onClick={() => setIsFlipped(!isFlipped)} role="button" tabIndex={0} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setIsFlipped(!isFlipped)} aria-pressed={isFlipped}>
      <div className={`flashcard-inner ${isFlipped ? 'is-flipped' : ''}`}>
        <div className="flashcard-front">
          <p>{question}</p>
        </div>
        <div className="flashcard-back">
          <p>{answer}</p>
        </div>
      </div>
    </div>
  );
};


const App: React.FC = () => {
  const [studyMaterial, setStudyMaterial] = useState<string>('');
  const [generatedContent, setGeneratedContent] = useState<Record<string, string> | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>('summary');
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [isSpeechApiSupported, setIsSpeechApiSupported] = useState<boolean>(false);
  const recognitionRef = useRef<any | null>(null);
  const [diagramType, setDiagramType] = useState<string>('flowchart');
  const [saveButtonText, setSaveButtonText] = useState<string>('Save Session');
  const [hasSavedSession, setHasSavedSession] = useState<boolean>(false);

  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [speakingText, setSpeakingText] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  
  const [chatSession, setChatSession] = useState<Chat | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState<string>('');
  const [isChatLoading, setIsChatLoading] = useState<boolean>(false);
  const chatMessagesEndRef = useRef<HTMLDivElement | null>(null);


  const [testState, setTestState] = useState<TestState>({
    status: 'idle',
    questions: [],
    userAnswers: {},
    currentQuestionIndex: 0,
    score: 0,
    suggestions: '',
    suggestionsLoading: false,
  });
  const [videoState, setVideoState] = useState<VideoState>({
    status: 'idle',
    url: null,
    loadingMessage: '',
  });


  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      setIsSpeechApiSupported(true);
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let final_transcript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            final_transcript += event.results[i][0].transcript;
          }
        }
        if (final_transcript) {
          setStudyMaterial(prev => (prev ? prev.trim() + ' ' : '') + final_transcript.trim());
        }
      };

      recognition.onstart = () => { setIsRecording(true); setError(null); };
      recognition.onend = () => { setIsRecording(false); };
      recognition.onerror = (event: any) => {
        console.error('Speech recognition error', event.error);
        setError(`Speech recognition error: ${event.error}. Please ensure microphone access is granted.`);
        setIsRecording(false);
      };
      recognitionRef.current = recognition;
    } else {
      setIsSpeechApiSupported(false);
    }
  }, []);
  
    useEffect(() => {
        if (activeTab === 'diagram' && generatedContent?.diagram && typeof window.mermaid !== 'undefined') {
            const mermaidContainer = document.querySelector('.mermaid');
            if (mermaidContainer) {
                // Clean the mermaid code from markdown fences
                let mermaidCode = generatedContent.diagram;
                const codeBlockRegex = /```(?:mermaid)?\s*([\s\S]*?)\s*```/;
                const match = mermaidCode.match(codeBlockRegex);

                if (match && match[1]) {
                    mermaidCode = match[1].trim();
                } else {
                    mermaidCode = mermaidCode.trim();
                }
                
                mermaidContainer.removeAttribute('data-processed');
                mermaidContainer.innerHTML = mermaidCode;
                try {
                    window.mermaid.run({ nodes: [mermaidContainer] });
                } catch (e) {
                    console.error("Mermaid render error:", e);
                    mermaidContainer.innerHTML = 'Error rendering diagram. Please check the generated syntax.';
                }
            }
        }
    }, [activeTab, generatedContent?.diagram]);
  
  useEffect(() => {
    setHasSavedSession(!!localStorage.getItem('aiStudySession'));
  }, []);

  useEffect(() => {
    // Cleanup speech synthesis and search on tab change or new content generation
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      setSpeakingText('');
    }
    setSearchQuery('');
  }, [activeTab, generatedContent]);

    useEffect(() => {
        chatMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [chatHistory, isChatLoading]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);


  const toggleRecording = () => {
    if (!recognitionRef.current) return;
    if (isRecording) {
      recognitionRef.current.stop();
    } else {
      recognitionRef.current.start();
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      readFile(file);
    }
  };

  const readFile = (file: File) => {
    const reader = new FileReader();
    if (file.type === 'application/pdf') {
        reader.onload = async (e) => {
            const typedarray = new Uint8Array(e.target?.result as ArrayBuffer);
            try {
                const pdf = await pdfjsLib.getDocument(typedarray).promise;
                let text = '';
                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const textContent = await page.getTextContent();
                    text += textContent.items.map((s: any) => s.str).join(' ');
                }
                setStudyMaterial(text);
            } catch (err) {
                console.error("Error reading PDF:", err);
                setError('Error parsing PDF file.');
            }
        };
        reader.readAsArrayBuffer(file);
    } else {
        reader.onload = (e) => {
            const text = e.target?.result as string;
            setStudyMaterial(text);
        };
        reader.onerror = () => {
            setError('Error reading file.');
        }
        reader.readAsText(file);
    }
  }

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(true);
  };
  
  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
  };
  
  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file && (file.type.startsWith('text/') || file.type === 'application/pdf')) {
       readFile(file);
    } else {
        setError('Please drop a valid text or PDF file.');
    }
  };

  const saveSession = () => {
    if (!studyMaterial.trim() && !generatedContent) {
        setError("Nothing to save.");
        return;
    }
    try {
        const sessionData = {
            studyMaterial,
            generatedContent,
            chatHistory,
        };
        localStorage.setItem('aiStudySession', JSON.stringify(sessionData));
        setHasSavedSession(true);
        setSaveButtonText('Saved!');
        setTimeout(() => {
            setSaveButtonText('Save Session');
        }, 2000);
    } catch (e) {
        console.error("Failed to save session:", e);
        setError("Could not save session. Storage might be full.");
    }
  };

  const loadSession = async () => {
      const savedSessionJSON = localStorage.getItem('aiStudySession');
      if (savedSessionJSON) {
          try {
              const sessionData = JSON.parse(savedSessionJSON);
              setStudyMaterial(sessionData.studyMaterial || '');
              setGeneratedContent(sessionData.generatedContent || null);
              setChatHistory(sessionData.chatHistory || []);
              
              // Re-initialize chat session
              if (sessionData.studyMaterial) {
                  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
                  const chat = ai.chats.create({
                      model: 'gemini-2.5-flash',
                      config: {
                          systemInstruction: `You are a helpful study tutor. Your knowledge is strictly limited to the following text. Do not answer any questions outside of this context.\n\n---CONTEXT---\n${sessionData.studyMaterial}\n---END CONTEXT---`
                      },
                      history: (sessionData.chatHistory || []).map((msg: ChatMessage) => ({
                          role: msg.role,
                          parts: [{ text: msg.text }]
                      }))
                  });
                  setChatSession(chat);
              } else {
                   setChatSession(null);
              }

              // Reset other states
              setTestState({
                  status: 'idle',
                  questions: [],
                  userAnswers: {},
                  currentQuestionIndex: 0,
                  score: 0,
                  suggestions: '',
                  suggestionsLoading: false,
              });
              setVideoState({ status: 'idle', url: null, loadingMessage: ''});
              setActiveTab('summary');
              setError(null);
          } catch (e) {
              console.error("Failed to load session:", e);
              setError("Could not load the saved session. The data might be corrupted.");
              localStorage.removeItem('aiStudySession');
              setHasSavedSession(false);
          }
      } else {
          setError("No saved session found.");
      }
  };

  const clearAllData = () => {
    if (window.confirm("Are you sure you want to clear all data? This will remove the current session and any saved sessions.")) {
        try {
            // Stop ongoing processes first
            if (isRecording && recognitionRef.current) {
                recognitionRef.current.stop();
            }
            if (window.speechSynthesis.speaking) {
                window.speechSynthesis.cancel();
            }

            // Clear storage
            localStorage.removeItem('aiStudySession');
            
            // Reset all state variables
            setStudyMaterial('');
            setGeneratedContent(null);
            setError(null);
            setActiveTab('summary');
            setDiagramType('flowchart');
            setSearchQuery('');
            setTestState({
                status: 'idle',
                questions: [],
                userAnswers: {},
                currentQuestionIndex: 0,
                score: 0,
                suggestions: '',
                suggestionsLoading: false,
            });
            setVideoState({ status: 'idle', url: null, loadingMessage: '' });
            setChatSession(null);
            setChatHistory([]);
            setChatInput('');
            setIsChatLoading(false);
            setHasSavedSession(false);
            setSaveButtonText('Save Session');
            setIsSpeaking(false);
            setSpeakingText('');
            
        } catch (e) {
            console.error("Failed to clear data:", e);
            setError("Could not clear all data. Please try again.");
        }
    }
  };
    
    const TABS = [
      { id: 'summary', label: 'Summary', icon: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" /></svg> },
      { id: 'chat', label: 'Chat', icon: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" /></svg> },
      { id: 'mcqs', label: 'Quiz', icon: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg> },
      { id: 'explanations', label: 'Explain', icon: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.311a7.5 7.5 0 0 1-7.5 0c-1.255 0-2.443.29-3.5.832M12 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg> },
      { id: 'mindmap', label: 'Mind Map', icon: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.042 21.672 13.684 16.6m0 0-2.51 2.225.569-9.47 5.227 7.917-3.286-.672ZM12 2.25V4.5m5.834.166-1.591 1.591M20.25 10.5H18M10.5 20.25v-2.25m-5.834-.166 1.591-1.591M3.75 10.5H6M10.5 3.75v2.25" /></svg> },
      { id: 'diagram', label: 'Diagram', icon: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75" /></svg> },
      { id: 'flashcards', label: 'Flashcards', icon: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" /></svg> },
      { id: 'examPrep', label: 'Exam Prep', icon: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" /></svg> },
      { id: 'video', label: 'Explainer Video', icon: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15.91 11.672a.375.375 0 0 1 0 .656l-5.603 3.113a.375.375 0 0 1-.557-.328V8.887c0-.286.307-.466.557-.327l5.603 3.112Z" /></svg> },
  ];

  const exportNotes = () => {
    if (!generatedContent) {
        setError("No content to export.");
        return;
    }

    const markdownContent = TABS
        .map(tab => {
            if (tab.id === 'video' || tab.id === 'chat') return null; // Skip non-exportable tabs
            const content = generatedContent[tab.id];
            if (!content) return null;

            let sectionContent = `## ${tab.label}\n\n`;
            
            if (tab.id === 'diagram') {
                sectionContent += '```mermaid\n' + content + '\n```';
            } else {
                sectionContent += content;
            }
            
            return sectionContent;
        })
        .filter(Boolean)
        .join('\n\n---\n\n');

    if (!markdownContent.trim()) {
        setError("No text content available to export.");
        return;
    }

    const blob = new Blob([markdownContent], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'ai-study-notes.md';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };


  const parseGeneratedContent = (rawText: string): Record<string, string> => {
    const sections: Record<string, string> = {
        summary: '###SUMMARY###',
        mcqs: '###MCQS###',
        explanations: '###EXPLANATIONS###',
        mindmap: '###MINDMAP###',
        diagram: '###DIAGRAM###',
        flashcards: '###FLASHCARDS###',
        examPrep: '###EXAM_PREP###',
    };
    
    const parsed: Record<string, string> = {};
    const sectionKeys = Object.keys(sections);
    const delimiters = Object.values(sections);
    const parts = rawText.split(new RegExp(`(${delimiters.join('|')})`));

    for (let i = 1; i < parts.length; i += 2) {
        const delimiter = parts[i];
        const content = parts[i + 1] || '';
        const sectionKey = sectionKeys.find(key => sections[key] === delimiter);
        if (sectionKey) {
            parsed[sectionKey] = content.trim();
        }
    }
    
    return parsed;
  };

  const generateStudyAids = useCallback(async () => {
    if (!studyMaterial.trim()) {
      setError('Please provide study material.');
      return;
    }
    setIsLoading(true);
    setError(null);
    setGeneratedContent(null);
    setChatSession(null);
    setChatHistory([]);
    setTestState({ ...testState, status: 'idle' });
    setVideoState({ status: 'idle', url: null, loadingMessage: ''});

    const getDiagramInstruction = (type: string) => {
        switch (type) {
            case 'mindmap':
                return 'Analyze the content and create a mind map to visually represent the key concepts and their relationships. Use Mermaid.js `mindmap` syntax. For example: `mindmap\\n root((topic))\\n ...`. Do not add any explanation, just the code block.';
            case 'sequencediagram':
                return 'Analyze the content for interactions between components or actors and create a sequence diagram. Use Mermaid.js `sequenceDiagram` syntax. For example: `sequenceDiagram\\n Alice->>John: Hello John, how are you?`. Do not add any explanation, just the code block.';
            case 'flowchart':
            default:
                return 'Analyze the content and create a flowchart to visually illustrate the main steps or components of the process described. You MUST use Mermaid.js `graph` syntax. For example, for a flowchart: `graph TD; A-->B;`. Do not add any explanation, just the code block.';
        }
    };

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
      const prompt = `
        You are an AI Smart Study Assistant for students.
        The user will provide study material.
        Your tasks are to generate the following sections based on the material.
        IMPORTANT: Each section must start with a unique delimiter on a new line. The delimiters are:
        ###SUMMARY### (For 📌 Summary)
        ###MCQS### (For 🎯 MCQs & Quiz)
        ###EXPLANATIONS### (For 📖 Explanations of Key Terms)
        ###MINDMAP### (For 🗺 Mind Map / Flowchart)
        ###DIAGRAM### (For 📊 Diagram / Chart)
        ###FLASHCARDS### (For 📝 Flashcards)
        ###EXAM_PREP### (For ❓ Expected Exam Questions & Model Answers)

        1.  **Summarization (###SUMMARY###)**
            - Create a short and clear summary of the content in simple student-friendly language.
            - Highlight key points, definitions, and formulas.

        2.  **MCQs & Quiz Generator (###MCQS###)**
            - Generate 5-10 high-quality multiple-choice questions (MCQs) that cover a wide range of topics from the provided material.
            - Ensure a good distribution of difficulty: include a mix of easy (recall-based), medium (application-based), and hard (analytical/evaluative) questions.
            - The questions should be challenging and test for a deep understanding of the material, not just surface-level memorization.
            - For each question, provide 4 plausible options.
            - Clearly mark the correct answer on a new line below the options, like "**Correct Answer:** [The correct option]".

        3.  **Explanations (###EXPLANATIONS###)**
            - Explain difficult terms or concepts in simple words, as if teaching a beginner.
            - Provide real-life examples wherever possible.

        4.  **Mind Map / Flowchart Creation (###MINDMAP###)**
            - Convert the text into a structured outline that can be used as a mind map or flowchart.
            - Use indentation, arrows (→), or bullet hierarchy to show connections.
            
        5. **Diagram/Chart (###DIAGRAM###)**
            - ${getDiagramInstruction(diagramType)}

        6.  **Flashcards for Quick Revision (###FLASHCARDS###)**
            - Create Q&A flashcards (Question on front, Answer on back style). Format each as "Q: [Question]\\nA: [Answer]" and separate cards with a blank line.

        7.  **Exam Preparation Support (###EXAM_PREP###)**
            - Predict possible exam questions from the given notes.
            - Provide model answers for 2–3 important questions.

        --- START OF MATERIAL ---
        ${studyMaterial}
        --- END OF MATERIAL ---
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });

      const parsed = parseGeneratedContent(response.text);
      setGeneratedContent(parsed);
      
      // Initialize chat session
      const chat = ai.chats.create({
          model: 'gemini-2.5-flash',
          config: {
              systemInstruction: `You are a helpful study tutor. Your knowledge is strictly limited to the following text. Do not answer any questions outside of this context. If a user asks something you cannot answer from the text, politely state that the information is not in their study material.\n\n---CONTEXT---\n${studyMaterial}\n---END CONTEXT---`
          }
      });
      setChatSession(chat);

      setActiveTab('summary');

    } catch (err) {
      setError('Failed to generate study aids. Please try again.');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, [studyMaterial, diagramType]);
  
  const generateVideo = useCallback(async () => {
    if (!generatedContent?.summary) {
      setError("A summary must be generated first to create a video.");
      return;
    }

    setVideoState({ status: 'loading', url: null, loadingMessage: "Initializing video generation..." });
    setError(null);

    const loadingMessages = [
      "Warming up the director's chair...",
      "Scripting the main points...",
      "Casting pixels for their roles...",
      "Setting up the virtual cameras...",
      "Rendering the first scene...",
      "Adding some background music (in our minds)...",
      "Finalizing the edits...",
      "The premiere is just moments away!",
    ];

    let messageIndex = 0;
    const interval = setInterval(() => {
      setVideoState(prevState => ({ ...prevState, loadingMessage: loadingMessages[messageIndex] }));
      messageIndex = (messageIndex + 1) % loadingMessages.length;
    }, 4000);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
      const prompt = `Create a short, engaging explainer video based on this summary. Keep it concise and visually interesting: ${generatedContent.summary}`;

      let operation = await ai.models.generateVideos({
        model: 'veo-2.0-generate-001',
        prompt: prompt,
        config: { numberOfVideos: 1 }
      });

      while (!operation.done) {
        await new Promise(resolve => setTimeout(resolve, 10000));
        operation = await ai.operations.getVideosOperation({ operation: operation });
      }

      if (operation.response?.generatedVideos?.[0]?.video?.uri) {
        const downloadLink = operation.response.generatedVideos[0].video.uri;
        const response = await fetch(`${downloadLink}&key=${process.env.API_KEY as string}`);
        const videoBlob = await response.blob();
        const url = URL.createObjectURL(videoBlob);
        setVideoState({ status: 'success', url: url, loadingMessage: '' });
      } else {
        throw new Error("Video generation completed but no video URI was found.");
      }
    } catch (err) {
      console.error("Video generation failed:", err);
      setError("Sorry, something went wrong while creating the video. Please try again.");
      setVideoState(prevState => ({ ...prevState, status: 'error' }));
    } finally {
      clearInterval(interval);
    }
  }, [generatedContent]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !chatSession || isChatLoading) return;
  
    const userMessage: ChatMessage = { role: 'user', text: chatInput };
    setChatInput('');
    setChatHistory(prev => [...prev, userMessage]);
    setIsChatLoading(true);
  
    try {
      const responseStream = await chatSession.sendMessageStream({ message: chatInput });
      let aiResponseText = '';
      
      // Add a placeholder for the streaming response
      setChatHistory(prev => [...prev, { role: 'model', text: '' }]);
  
      for await (const chunk of responseStream) {
        aiResponseText += chunk.text;
        // Update the last message in the history with the new text
        setChatHistory(prev => {
          const newHistory = [...prev];
          if (newHistory.length > 0 && newHistory[newHistory.length - 1].role === 'model') {
            newHistory[newHistory.length - 1].text = aiResponseText;
          }
          return newHistory;
        });
      }
    } catch (err) {
      console.error("Chat error:", err);
      const errorMessage: ChatMessage = { role: 'model', text: 'Sorry, I encountered an error. Please try again.' };
      setChatHistory(prev => [...prev, errorMessage]);
    } finally {
      setIsChatLoading(false);
    }
  };
   

  const parsedFlashcards = useMemo(() => {
    if (!generatedContent?.flashcards) return [];
    const text = generatedContent.flashcards;
    const cardsRaw = text.split(/\n\s*\n/);
    return cardsRaw.map(card => {
        const lines = card.split('\n');
        const qLine = lines.find(line => line.toUpperCase().startsWith('Q:'));
        const aLine = lines.find(line => line.toUpperCase().startsWith('A:'));
        if(qLine && aLine){
            return { q: qLine.substring(2).trim(), a: aLine.substring(2).trim() };
        }
        return null;
    }).filter((c): c is { q: string; a: string } => c !== null && c.q !== '' && c.a !== '');
  }, [generatedContent]);

    // Test logic
    const parseMCQsForTest = (mcqText: string): TestQuestion[] => {
        const questions: TestQuestion[] = [];
        // Split by question number (e.g., "1.", "2.") at the beginning of a line.
        const questionBlocks = mcqText.split(/\n\s*(?=\d+\.\s)/).filter(b => b.trim());

        questionBlocks.forEach((block, index) => {
            const lines = block.trim().split('\n');
            const questionLine = lines.shift()?.replace(/^\d+\.\s*/, '').trim();
            if (!questionLine) return;

            const options: string[] = [];
            let correctAnswer: string | null = null;
            
            // Find the line that explicitly marks the answer
            const answerLine = lines.find(line => /correct answer/i.test(line));
            
            // Filter for lines that are actual options
            const optionLines = lines.filter(line => /^\s*[a-d][\)\.]/i.test(line));

            optionLines.forEach(line => {
                const text = line.trim().replace(/^[a-d][\)\.]\s*/i, '').trim();
                options.push(text);
            });

            if (answerLine) {
                // Try to find the correct answer letter (e.g., "Answer: C")
                const letterMatch = answerLine.match(/[a-d]/i);
                if (letterMatch) {
                    const letterIndex = letterMatch[0].toLowerCase().charCodeAt(0) - 'a'.charCodeAt(0);
                    if (options[letterIndex]) {
                        correctAnswer = options[letterIndex];
                    }
                }
                // If no letter match, try to find the full answer text within the answer line
                if (!correctAnswer) {
                    const foundOption = options.find(opt => answerLine.includes(opt));
                    if (foundOption) {
                        correctAnswer = foundOption;
                    }
                }
            } else {
                // Fallback for when the answer is marked inline with the option
                const correctOptionLine = optionLines.find(line => /\(Correct Answer\)|Correct Answer:/i.test(line));
                if (correctOptionLine) {
                    correctAnswer = correctOptionLine.trim().replace(/^[a-d][\)\.]\s*/i, '').replace(/\(Correct Answer\)|Correct Answer:/i, '').trim();
                }
            }

            // Clean any stray markers from options that might have been missed
            const cleanedOptions = options.map(opt => opt.replace(/\(Correct Answer\)|Correct Answer:/i, '').trim());
            
            // The correct answer must also be cleaned
            if(correctAnswer) {
                correctAnswer = correctAnswer.replace(/\(Correct Answer\)|Correct Answer:/i, '').trim();
            }

            if (questionLine && cleanedOptions.length >= 2 && correctAnswer && cleanedOptions.includes(correctAnswer)) {
                questions.push({
                    question: questionLine,
                    options: cleanedOptions.sort(() => Math.random() - 0.5), // Shuffle options
                    correctAnswer,
                    questionNumber: index + 1
                });
            } else {
                 console.warn("Skipping malformed question block:", {block, questionLine, cleanedOptions, correctAnswer});
            }
        });
        return questions;
    };
    
    const startTest = () => {
        if (!generatedContent?.mcqs) return;
        const questions = parseMCQsForTest(generatedContent.mcqs);
        if (questions.length > 0) {
            setTestState({
                status: 'taking',
                questions,
                userAnswers: {},
                currentQuestionIndex: 0,
                score: 0,
                suggestions: '',
                suggestionsLoading: false,
            });
        } else {
            setError("Could not parse any valid questions for the test.");
        }
    };

    const handleAnswerSelect = (questionNumber: number, answer: string) => {
        setTestState(prev => ({ ...prev, userAnswers: { ...prev.userAnswers, [questionNumber]: answer }}));
    };

    const submitTest = async () => {
        let currentScore = 0;
        testState.questions.forEach(q => {
            if(testState.userAnswers[q.questionNumber] === q.correctAnswer) {
                currentScore++;
            }
        });
        
        setTestState(prev => ({ ...prev, status: 'finished', score: currentScore, suggestionsLoading: true }));

        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
            const feedbackPrompt = `
                A student has just completed a test based on the following study material.
                Here is the analysis of their performance. Please provide constructive feedback.

                --- STUDY MATERIAL ---
                ${studyMaterial.substring(0, 2000)}... 
                --- END STUDY MATERIAL ---

                --- TEST RESULTS ---
                Total Questions: ${testState.questions.length}
                Correct Answers: ${currentScore}
                Incorrect Answers: ${testState.questions.length - currentScore}

                Here are the questions the student answered incorrectly:
                ${testState.questions
                    .filter(q => testState.userAnswers[q.questionNumber] !== q.correctAnswer)
                    .map(q => `
                        Question: ${q.question}
                        Their Answer: ${testState.userAnswers[q.questionNumber] || "No answer"}
                        Correct Answer: ${q.correctAnswer}
                    `).join('\n')}
                --- END TEST RESULTS ---

                Based on this, please provide:
                1. A brief, encouraging summary of their performance.
                2. A list of the key topics or concepts they seem to be struggling with.
                3. For each incorrect answer, a simple explanation of why their answer was wrong and the correct answer is right.
                4. Actionable suggestions for what to review or how to approach these topics differently.
            `;
            const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: feedbackPrompt });
            setTestState(prev => ({ ...prev, suggestions: response.text, suggestionsLoading: false }));
        } catch (err) {
            console.error("Failed to get suggestions:", err);
            setTestState(prev => ({ ...prev, suggestions: "Sorry, I couldn't generate feedback at this time.", suggestionsLoading: false }));
        }
    };

    const handleToggleSpeech = (textToSpeak: string) => {
        if (isSpeaking && speakingText === textToSpeak) {
            window.speechSynthesis.cancel();
            setIsSpeaking(false);
            setSpeakingText('');
        } else {
            if (window.speechSynthesis.speaking) {
                window.speechSynthesis.cancel();
            }
            const utterance = new SpeechSynthesisUtterance(textToSpeak);
            utterance.onstart = () => {
                setIsSpeaking(true);
                setSpeakingText(textToSpeak);
            };
            utterance.onend = () => {
                setIsSpeaking(false);
                setSpeakingText('');
            };
            utterance.onerror = () => {
                setIsSpeaking(false);
                setSpeakingText('');
                setError("Sorry, text-to-speech is not available right now.");
            };
            window.speechSynthesis.speak(utterance);
        }
    };

  const renderTabContent = () => {
    if (!generatedContent && !chatSession) return null;

    const searchableTabs = ['explanations', 'examPrep'];
    const isSearchable = searchableTabs.includes(activeTab);

    if (activeTab === 'summary') {
        const content = generatedContent?.summary;
        if (!content) return null;

        const plainText = new DOMParser().parseFromString(marked(content) as string, "text/html").body.textContent || "";
        const isCurrentlySpeaking = isSpeaking && speakingText === plainText;

        return (
            <div className="content-with-tts">
                <button
                    className={`btn-tts ${isCurrentlySpeaking ? 'speaking' : ''}`}
                    onClick={() => handleToggleSpeech(plainText)}
                    aria-label={isCurrentlySpeaking ? "Stop listening" : "Listen to this section"}
                    title={isCurrentlySpeaking ? "Stop listening" : "Listen to this section"}
                >
                    {isCurrentlySpeaking ? (
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M5.25 7.5A2.25 2.25 0 0 1 7.5 5.25h9a2.25 2.25 0 0 1 2.25 2.25v9a2.25 2.25 0 0 1-2.25 2.25h-9a2.25 2.25 0 0 1-2.25-2.25v-9Z" /></svg>
                    ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M2.25 3.75a.75.75 0 0 0-1.5 0v16.5a.75.75 0 0 0 1.5 0V3.75Z" /><path d="M5.41 6.598a.75.75 0 0 0-.001 1.06l4.242 4.243a.75.75 0 0 0 1.06 0l4.242-4.243a.75.75 0 1 0-1.06-1.06L10.5 9.939 6.47 5.908a.75.75 0 0 0-1.06.69Z" transform="rotate(90 12 12)"/></svg>
                    )}
                </button>
                <div className="content-scroll-wrapper" dangerouslySetInnerHTML={{ __html: marked(content) as string }} />
            </div>
        );
    }
    
    if (isSearchable) {
        const content = generatedContent?.[activeTab];
        if (!content) return null;

        const getHighlightedHTML = () => {
            if (!searchQuery.trim()) {
                return marked(content) as string;
            }
            const escapedQuery = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`(${escapedQuery})`, 'gi');
            const highlightedContent = content.replace(regex, '<mark>$1</mark>');
            return marked(highlightedContent) as string;
        };
        
        const plainText = new DOMParser().parseFromString(marked(content) as string, "text/html").body.textContent || "";
        const isCurrentlySpeaking = isSpeaking && speakingText === plainText;
        
        return (
             <>
                <div className="search-and-tts-bar">
                    <div className="search-bar-container">
                        <input
                            type="search"
                            placeholder={`Search in ${TABS.find(t => t.id === activeTab)?.label}...`}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="search-input"
                        />
                    </div>
                    {activeTab === 'explanations' && (
                         <button
                            className={`btn-tts ${isCurrentlySpeaking ? 'speaking' : ''}`}
                            onClick={() => handleToggleSpeech(plainText)}
                            aria-label={isCurrentlySpeaking ? "Stop listening" : "Listen to this section"}
                            title={isCurrentlySpeaking ? "Stop listening" : "Listen to this section"}
                        >
                            {isCurrentlySpeaking ? (
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M5.25 7.5A2.25 2.25 0 0 1 7.5 5.25h9a2.25 2.25 0 0 1 2.25 2.25v9a2.25 2.25 0 0 1-2.25 2.25h-9a2.25 2.25 0 0 1-2.25-2.25v-9Z" /></svg>
                            ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M2.25 3.75a.75.75 0 0 0-1.5 0v16.5a.75.75 0 0 0 1.5 0V3.75Z" /><path d="M5.41 6.598a.75.75 0 0 0-.001 1.06l4.242 4.243a.75.75 0 0 0 1.06 0l4.242-4.243a.75.75 0 1 0-1.06-1.06L10.5 9.939 6.47 5.908a.75.75 0 0 0-1.06.69Z" transform="rotate(90 12 12)"/></svg>
                            )}
                        </button>
                    )}
                </div>
                <div className="content-scroll-wrapper" dangerouslySetInnerHTML={{ __html: getHighlightedHTML() }} />
            </>
        )
    }

    if (activeTab === 'flashcards') {
        return (
            <div className="flashcard-grid">
                {parsedFlashcards.length > 0 ? (
                    parsedFlashcards.map((card, index) => (
                        <Flashcard key={index} question={card.q} answer={card.a} />
                    ))
                ) : (
                    <p>No valid flashcards found in the generated content.</p>
                )}
            </div>
        )
    }
    
    if (activeTab === 'mcqs') {
        return (
            <div>
                 <div dangerouslySetInnerHTML={{ __html: marked(generatedContent![activeTab]) as string }} />
                 <button className="btn btn-primary" onClick={startTest} style={{marginTop: '2rem', width: '100%'}}>Take The Test</button>
            </div>
        )
    }
    
    if (activeTab === 'chat') {
        return (
            <div className="chat-container">
                <div className="chat-messages">
                    {chatHistory.map((msg, index) => (
                        <div key={index} className={`chat-message ${msg.role}-message`}>
                             <div dangerouslySetInnerHTML={{ __html: marked(msg.text) as string }} />
                        </div>
                    ))}
                    {isChatLoading && (
                        <div className="chat-message model-message">
                            <div className="typing-indicator">
                                <span></span><span></span><span></span>
                            </div>
                        </div>
                    )}
                    <div ref={chatMessagesEndRef} />
                </div>
                <form className="chat-input-form" onSubmit={handleSendMessage}>
                    <input
                        type="text"
                        className="chat-input"
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        placeholder="Ask a question about your notes..."
                        aria-label="Chat input"
                        disabled={isChatLoading}
                    />
                    <button type="submit" className="btn btn-icon chat-send-btn" disabled={isChatLoading || !chatInput.trim()}>
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" /></svg>
                    </button>
                </form>
            </div>
        );
    }

    if (activeTab === 'diagram') {
        return (
            <div className="diagram-container">
                <div className="mermaid">
                    {generatedContent![activeTab]}
                </div>
            </div>
        )
    }
    
    if (activeTab === 'video') {
        return (
            <div className="video-container">
                {videoState.status === 'idle' && (
                    <div className="video-placeholder">
                        <h3>Create an Explainer Video</h3>
                        <p>Turn the summary of your study material into a short, animated video.</p>
                        <button className="btn btn-primary" onClick={generateVideo}>Generate Video</button>
                    </div>
                )}
                {videoState.status === 'loading' && (
                     <div className="video-loading">
                        <div className="pulsating-loader"></div>
                        <p className="loading-message">{videoState.loadingMessage}</p>
                    </div>
                )}
                {videoState.status === 'success' && videoState.url && (
                     <div className="video-player-wrapper">
                        <video controls autoPlay src={videoState.url} />
                        <button className="btn btn-secondary" onClick={generateVideo} style={{marginTop: '1rem'}}>Regenerate Video</button>
                    </div>
                )}
                {(videoState.status === 'error' || (videoState.status === 'success' && !videoState.url)) && (
                     <div className="video-placeholder">
                        <p className="error-message">{error || "Failed to generate video."}</p>
                        <button className="btn btn-primary" onClick={generateVideo}>Try Again</button>
                    </div>
                )}
            </div>
        )
    }

    if (generatedContent && generatedContent[activeTab]) {
      return <div className="content-scroll-wrapper" dangerouslySetInnerHTML={{ __html: marked(generatedContent[activeTab]) as string }} />;
    }
    
    return null;
  };
  
    const renderOutput = () => {
        if (isLoading) {
            return (
                <div className="loader-container">
                    <div className="pulsating-loader"></div>
                </div>
            );
        }

        if (testState.status === 'taking') {
            const currentQuestion = testState.questions[testState.currentQuestionIndex];
            return (
                <div className="test-container">
                    <h2>Quiz Time!</h2>
                    <div className="progress-bar">
                        <div className="progress" style={{ width: `${((testState.currentQuestionIndex + 1) / testState.questions.length) * 100}%` }}></div>
                    </div>
                    <p className="question-counter">Question {testState.currentQuestionIndex + 1} of {testState.questions.length}</p>
                    <div className="test-question-box">
                        <h3>{currentQuestion.question}</h3>
                        <div className="test-options">
                            {currentQuestion.options.map((option, i) => (
                                <label key={i} className={`test-option ${testState.userAnswers[currentQuestion.questionNumber] === option ? 'selected' : ''}`}>
                                    <input
                                        type="radio"
                                        name={`question-${currentQuestion.questionNumber}`}
                                        value={option}
                                        checked={testState.userAnswers[currentQuestion.questionNumber] === option}
                                        onChange={() => handleAnswerSelect(currentQuestion.questionNumber, option)}
                                    />
                                    <span>{option}</span>
                                </label>
                            ))}
                        </div>
                    </div>
                    <div className="test-navigation">
                        <button className="btn btn-secondary" disabled={testState.currentQuestionIndex === 0} onClick={() => setTestState(p => ({...p, currentQuestionIndex: p.currentQuestionIndex - 1}))}>Previous</button>
                        {testState.currentQuestionIndex < testState.questions.length - 1 ? (
                            <button className="btn btn-primary" onClick={() => setTestState(p => ({...p, currentQuestionIndex: p.currentQuestionIndex + 1}))}>Next</button>
                        ) : (
                            <button className="btn btn-primary" onClick={submitTest}>Submit Test</button>
                        )}
                    </div>
                </div>
            );
        }

        if (testState.status === 'finished') {
            return (
                <div className="results-container">
                    <h2>Test Results</h2>
                    <div className="score-summary">
                        You scored <span className="score">{testState.score}</span> out of <span className="score">{testState.questions.length}</span>
                    </div>

                    <div className="suggestions-box">
                        <h3>Personalized Feedback</h3>
                        {testState.suggestionsLoading ? (
                           <div className="mini-loader"></div>
                        ) : (
                            <div dangerouslySetInnerHTML={{ __html: marked(testState.suggestions) as string }}/>
                        )}
                    </div>
                    <button className="btn btn-secondary" onClick={() => setTestState(prev => ({ ...prev, status: 'idle' }))}>Back to Study Aids</button>
                </div>
            );
        }

        if (generatedContent) {
            const availableTabs = TABS.filter(tab => {
                if (tab.id === 'video') return true;
                if (tab.id === 'chat') return !!chatSession;
                return !!generatedContent[tab.id];
            });
            return (
                <>
                    <div className="tabs">
                    {availableTabs.map(tab => (
                        <button
                            key={tab.id}
                            className={`tab-button ${activeTab === tab.id ? 'active' : ''}`}
                            onClick={() => setActiveTab(tab.id)}
                            aria-controls={`tab-content-${tab.id}`}
                            aria-selected={activeTab === tab.id}
                            role="tab"
                        >
                            {tab.icon}
                            <span>{tab.label}</span>
                        </button>
                    ))}
                    </div>
                    <div className="tab-content" id={`tab-content-${activeTab}`} role="tabpanel">
                        {renderTabContent()}
                    </div>
                </>
            );
        }

        return (
             <div className="placeholder">
                 <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
                </svg>
              <h2>Your study aids will appear here</h2>
              <p>Just add your material and click "Generate"!</p>
            </div>
        );
    }


  return (
    <div className="app-container">
      <div className="input-section">
        <div className="header">
           <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.25a.75.75 0 0 1 .75.75v2.25a.75.75 0 0 1-1.5 0V3a.75.75 0 0 1 .75-.75ZM7.5 12a4.5 4.5 0 1 1 9 0 4.5 4.5 0 0 1-9 0ZM18.894 6.106a.75.75 0 0 1 0 1.06l-1.591 1.592a.75.75 0 0 1-1.06-1.061l1.591-1.592a.75.75 0 0 1 1.06 0ZM21.75 12a.75.75 0 0 1-.75.75h-2.25a.75.75 0 0 1 0-1.5h2.25a.75.75 0 0 1 .75.75ZM17.834 17.834a.75.75 0 0 1-1.06 0l-1.592-1.591a.75.75 0 1 1 1.06-1.06l1.591 1.591a.75.75 0 0 1 0 1.06ZM12 21.75a.75.75 0 0 1-.75-.75v-2.25a.75.75 0 0 1 1.5 0v2.25a.75.75 0 0 1-.75-.75ZM6.106 18.894a.75.75 0 0 1 0-1.06l1.592-1.591a.75.75 0 0 1 1.06 1.06l-1.591 1.592a.75.75 0 0 1-1.06 0ZM3 12a.75.75 0 0 1 .75-.75h2.25a.75.75 0 0 1 0 1.5H3.75A.75.75 0 0 1 3 12ZM6.166 6.166a.75.75 0 0 1 1.06 0l1.591 1.591a.75.75 0 1 1-1.06 1.06L6.166 7.227a.75.75 0 0 1 0-1.06Z" /></svg>
          <h1>AI Study Assistant</h1>
          <p>Paste your notes, upload a file, or use your voice.</p>
        </div>
        <div className={`textarea-container ${isDragging ? 'dragging' : ''}`} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
          <textarea
            id="study-material"
            value={studyMaterial}
            onChange={(e) => setStudyMaterial(e.target.value)}
            placeholder="Paste your study material here, or drop a text/PDF file..."
            aria-label="Study Material Input"
          />
          <div className="drag-drop-overlay">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l-3.75 3.75M12 9.75l3.75 3.75M17.25 8.25L21 12m-3.75 3.75L21 12m-3.75-3.75L17.25 15m3.75-3.75L17.25 9M9 12l-3.75-3.75L9 15m-3.75-3.75L9 9" /></svg>
            <p>Drop file to upload</p>
          </div>
        </div>
        <div className="action-bar">
            <button
                className={`btn btn-icon ${isRecording ? 'recording' : ''}`}
                onClick={toggleRecording}
                disabled={!isSpeechApiSupported}
                aria-label={isRecording ? 'Stop Recording' : 'Start Recording'}
                title={isSpeechApiSupported ? (isRecording ? 'Stop Recording' : 'Start Recording') : 'Voice input not supported by your browser'}
            >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 1.75a3.25 3.25 0 0 0-3.25 3.25v7a3.25 3.25 0 0 0 6.5 0v-7A3.25 3.25 0 0 0 12 1.75Z" />
                  <path d="M16.75 8a.75.75 0 0 0-1.5 0v2.25a3.25 3.25 0 0 1-6.5 0V8a.75.75 0 0 0-1.5 0v2.25c0 2.9 2.35 5.25 5.25 5.25s5.25-2.35 5.25-5.25V8Z" />
                  <path d="M12 17.25a.75.75 0 0 0 .75.75h.01a.75.75 0 0 0 .74-.74v-1.51c-1.03.23-2.09.23-3.13 0v1.51c.01.41.34.74.75.74h.01a.75.75 0 0 0 .74-.74v-.01h.75v.01Z" />
                </svg>
            </button>
             <label htmlFor="file-upload" className="btn btn-secondary file-input-label">
                Upload File
            </label>
            <input id="file-upload" type="file" accept=".txt,.md,.pdf" onChange={handleFileChange} />
            <button className="btn btn-secondary" onClick={saveSession} disabled={!studyMaterial.trim() && !generatedContent}>
                {saveButtonText}
            </button>
            <button className="btn btn-secondary" onClick={loadSession} disabled={!hasSavedSession}>
                Load Session
            </button>
            <button className="btn btn-secondary" onClick={exportNotes} disabled={!generatedContent}>
                Export Notes
            </button>
            <button className="btn btn-danger" onClick={clearAllData}>
                Clear All
            </button>
             <div className="select-wrapper">
                 <select
                    id="diagram-type"
                    value={diagramType}
                    onChange={(e) => setDiagramType(e.target.value)}
                  >
                    <option value="flowchart">Flowchart</option>
                    <option value="mindmap">Mind Map</option>
                    <option value="sequencediagram">Sequence Diagram</option>
                </select>
            </div>
            <button className="btn btn-primary" onClick={generateStudyAids} disabled={isLoading || !studyMaterial.trim()}>
                {isLoading ? 'Generating...' : 'Generate Study Aids'}
            </button>
        </div>
        {error && <p className="error-message">{error}</p>}
      </div>
      <div className="output-section">
        {renderOutput()}
      </div>
    </div>
  );
};

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<App />);
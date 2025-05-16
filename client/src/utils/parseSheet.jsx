import ActivityQuestionBlock from '../components/activity/ActivityQuestionBlock';
import ActivityHeader from '../components/activity/ActivityHeader';
import ActivityEnvironment from '../components/activity/ActivityEnvironment';
import ActivityPythonBlock from '../components/activity/ActivityPythonBlock';
import { Form } from 'react-bootstrap';

export function parseSheetToBlocks(lines) {
  console.log("🧑‍💻 parseSheetToBlocks invoked");
  const blocks = [];
  let groupNumber = 0;
  let questionLetterCode = 97;
  let responseId = 1;

  let currentQuestion = null;
  let currentField = 'prompt';
  let currentBlock = [];
  let currentGroupIntro = null;

  let inList = false;
  let listType = null;
  let listItems = [];

  const flushCurrentBlock = () => {
    if (currentBlock.length > 0) {
      blocks.push({
        type: 'text',
        content: currentBlock.join(' ').trim()
      });
      currentBlock = [];
    }
  };

  const format = (text) =>
    text
      .replace(/\\textbf\{(.+?)\}/g, '<strong>$1</strong>')
      .replace(/\\textit\{(.+?)\}/g, '<em>$1</em>')
      .replace(/\\text\{(.+?)\}/g, '$1');

  for (let line of lines) {
    const trimmed = line.trim();
    console.log("Processing line:", trimmed);

    // --- Lists ---
    if (trimmed === '\\begin{itemize}' || trimmed === '\\begin{enumerate}') {
      inList = true;
      listType = trimmed.includes('itemize') ? 'ul' : 'ol';
      listItems = [];
      continue;
    }

    if (trimmed === '\\end{itemize}' || trimmed === '\\end{enumerate}') {
      blocks.push({
        type: 'list',
        listType,
        items: listItems.map(format)
      });
      inList = false;
      listType = null;
      listItems = [];
      continue;
    }

    if (inList && trimmed.startsWith('\\item')) {
      listItems.push(trimmed.replace(/^\\item\s*/, ''));
      continue;
    }

    // --- Python block ---
    if (trimmed === '\\python') {
      flushCurrentBlock();
      currentField = 'python';

      if (currentQuestion && currentQuestion.type === 'question') {
        if (!currentQuestion.pythonBlocks) currentQuestion.pythonBlocks = [];
        currentQuestion.pythonBlocks.push({ lines: [] });
      } else {
        currentQuestion = { type: 'python', lines: [] };
      }
      continue;
    }

    if (trimmed === '\\endpython') {
      if (currentField === 'python') {
        if (currentQuestion?.type === 'python') {
          blocks.push({
            type: 'python',
            content: currentQuestion.lines.join('\n')
          });
          currentQuestion = null;
        } else if (currentQuestion?.pythonBlocks?.length > 0) {
          const block = currentQuestion.pythonBlocks.pop();
          currentQuestion.pythonBlocks.push({
            type: 'python',
            content: block.lines.join('\n')
          });
        }
        currentField = 'prompt';
      }
      continue;
    }

    if (currentField === 'python') {
      if (currentQuestion?.type === 'python') {
        currentQuestion.lines.push(line);
      } else if (currentQuestion?.pythonBlocks?.length > 0) {
        const lastBlock = currentQuestion.pythonBlocks[currentQuestion.pythonBlocks.length - 1];
        lastBlock.lines.push(line);
      }
      continue;
    }

    // --- Headers ---
    // --- Simple headers (title, name) ---
  const headerMatch = trimmed.match(/^\\(title|name)\{(.+?)\}$/);
  if (headerMatch) {
    flushCurrentBlock();
    blocks.push({
      type: 'header',
      tag: headerMatch[1],
      content: format(headerMatch[2])
    });
    continue;
  }

    // --- Sections (e.g., Learning Objectives, Content, Process)
    const sectionMatch = trimmed.match(/^\\section\*?\{(.+?)\}$/);
  if (sectionMatch) {
    flushCurrentBlock();
    blocks.push({
      type: 'section',
      name: format(sectionMatch[1]),
      content: []      // you may later collect nested blocks here if you want true sub‐trees
    });
    continue;
  }
 
  

    // --- Group start ---
    if (trimmed.startsWith('\\questiongroup{')) {
      flushCurrentBlock();
      groupNumber++;
      questionLetterCode = 97;
      const content = trimmed.match(/\\questiongroup\{(.+?)\}/)?.[1] || '';
      blocks.push({
        type: 'groupIntro',
        groupId: groupNumber,
        content: format(content)
      });
      continue;
    }

    if (trimmed === '\\endquestiongroup') {
      blocks.push({ type: 'endGroup' });
      continue;
    }

    // --- Question ---
    if (trimmed.startsWith('\\question{')) {
      const content = trimmed.match(/\\question\{(.+?)\}/)?.[1] || '';
      const id = String.fromCharCode(questionLetterCode++);
      currentQuestion = {
        type: 'question',
        id,
        label: `${id}.`,
        responseId: responseId++,
        prompt: format(content),
        responseLines: 1,
        samples: [],
        feedback: [],
        followups: []
      };
      continue;
    }

    if (trimmed === '\\endquestion') {
      if (currentQuestion !== null) {
        blocks.push(currentQuestion);
      } else {
        console.warn("⚠️ \\endquestion found without matching \\question");
      }
      currentQuestion = null;
      continue;
    }

    if (trimmed.startsWith('\\textresponse')) {
      const match = trimmed.match(/\\textresponse\{(\d+)\}/);
      if (!currentQuestion) {
        console.warn("⚠️ \\textresponse found outside of a question block");
        continue;
      }
      if (match) currentQuestion.responseLines = parseInt(match[1]);
      continue;
    }

    if (trimmed.startsWith('\\sampleresponses{')) {
      const match = trimmed.match(/\\sampleresponses\{(.+?)\}/);
      if (match && currentQuestion) currentQuestion.samples.push(format(match[1]));
      continue;
    }

    if (trimmed.startsWith('\\feedbackprompt{')) {
      const match = trimmed.match(/\\feedbackprompt\{(.+?)\}/);
      if (match && currentQuestion) currentQuestion.feedback.push(format(match[1]));
      continue;
    }

    if (trimmed.startsWith('\\followupprompt{')) {
      const match = trimmed.match(/\\followupprompt\{(.+?)\}/);
      if (match && currentQuestion) currentQuestion.followups.push(format(match[1]));
      continue;
    }

    // --- \textbf as line ---
    const textbfMatch = trimmed.match(/^\\textbf\{(.+?)\}$/);
    if (textbfMatch) {
      flushCurrentBlock();
      blocks.push({
        type: 'text',
        content: `<strong>${textbfMatch[1]}</strong>`
      });
      continue;
    }

    // --- Text fallback ---
    currentBlock.push(format(line));
  }

  flushCurrentBlock();
  return blocks;
}

export function renderBlocks(blocks, options = {}) {
  const {
    editable = false,
    isActive = false,
    onSave = () => {},
    onSubmit = () => {},
    mode = 'preview'
  } = options;

  const hiddenTypesInRun = ['sampleresponses', 'feedbackprompt', 'followupprompt'];

  return blocks.map((block, index) => {
    if (hiddenTypesInRun.includes(block.type) && mode !== 'preview') {
      return null;
    }

    if (block.type === 'endGroup') {
      return mode === 'preview'
        ? <hr key={`endgroup-${index}`} className="my-4" />
        : <div key={`endgroup-${index}`} data-type="endGroup" />;
    }

    if (block.type === 'header') {
      const Tag = block.tag === 'title' ? 'h2' : block.tag === 'section' ? 'h4' : 'p';
      return ( 
        <Tag key={`header-${index}`} className="my-3 font-bold">
          {block.content}
        </Tag>
      );
    }

    if (block.type === 'text') {
      return (
        <p key={`text-${index}`} className="my-2">
          <span dangerouslySetInnerHTML={{ __html: block.content }} />
        </p>
      );
    }

    if (block.type === 'list') {
      const ListTag = block.listType === 'ul' ? 'ul' : 'ol';
      return (
        <ListTag key={`list-${index}`} className="my-2 list-disc list-inside">
          {block.items.map((item, i) => (
            <li key={`list-item-${i}`}>
              <span dangerouslySetInnerHTML={{ __html: item }} />
            </li>
          ))}
        </ListTag>
      );
    }

    if (block.type === 'groupIntro') {
      return (
        <div key={`group-intro-${index}`} className="my-4 border-t pt-4">
          <h3 className="text-lg font-semibold">
            <span dangerouslySetInnerHTML={{ __html: block.content }} />
          </h3>
        </div>
      );
    }

    if (block.type === 'section') {
      return (
        <div key={`section-${index}`} className="my-4">
          <h4 className="font-semibold">{block.name}</h4>
          {block.content && block.content.length > 0 && (
            renderBlocks(block.content, options)
          )}
        </div>
      );
    }

    if (block.type === 'python') {
      return (
        <ActivityPythonBlock
          key={index}
          code={block.content}
          blockIndex={index}
          editable={editable}
          isActive={isActive}
          onSave={onSave}
          onSubmit={onSubmit}
        />
      );
    }

    if (block.type === 'question') {
      return (
        <div key={`q-${block.id}`} className="mb-3">
          <p>
            <strong>{block.label}</strong>{' '}
            <span dangerouslySetInnerHTML={{ __html: block.prompt }} />
          </p>

          {block.pythonBlocks?.map((py, i) => (
            <ActivityPythonBlock
              key={`q-${block.id}-py-${i}`}
              code={py.content}
              blockIndex={`${index}-${i}`}
              editable={editable}
              isActive={isActive}
              onSave={onSave}
              onSubmit={onSubmit}
            />
          ))}

          <Form.Control
            as="textarea"
            rows={block.responseLines || 1}
            defaultValue=""
            readOnly={!editable}
            className="mt-2"
          />

          {mode === 'preview' && (
            <>
              {block.samples?.length > 0 && (
                <div className="mt-2 text-muted small">
                  <strong>Sample Responses:</strong>
                  <ul>
                    {block.samples.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                </div>
              )}
              {block.feedback?.length > 0 && (
                <div className="mt-2 text-muted small">
                  <strong>Feedback Prompts:</strong>
                  <ul>
                    {block.feedback.map((f, i) => <li key={i}>{f}</li>)}
                  </ul>
                </div>
              )}
              {block.followups?.length > 0 && (
                <div className="mt-2 text-muted small">
                  <strong>Follow-up Prompts:</strong>
                  <ul>
                    {block.followups.map((f, i) => <li key={i}>{f}</li>)}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      );
    }

    console.warn(`Unhandled block type: ${block.type}`, block);
    return null;
  });
}
//End parseSheet.jsx

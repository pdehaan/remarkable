// Block lexer


'use strict';


////////////////////////////////////////////////////////////////////////////////
// Helpers


// Check if character is white space
function isWhiteSpace(ch) {
  // TODO: check other spaces and tabs
  return ch === 0x20;
}

// Check if line from `pos` is empty or contains spaces only
function isEmpty(state, line) {
  var ch, pos = state.bMarks[line], max = state.src.length;

  while (pos < max) {
    ch = state.src.charCodeAt(pos++);

    if (ch === 0x0A || ch === 0x0D) { return true; }

    if (!isWhiteSpace(ch)) { return false; }
  }

  return true; // EOL reached
}

// Return absolute position of char with default indent an given line,
// or -1 if no requested indent
function getIndent(state, line, indent) {
  var ch, pos, max;

  if (line >= state.lineMax) { return -1; }

  pos = state.bMarks[line];
  max = state.eMarks[line];

  while (pos < max && indent > 0) {
    ch = state.src.charCodeAt(pos++);
    if (ch === 0x09) { indent -= 4; continue; }
    if (isWhiteSpace(ch)) { indent--; continue; }
    return -1;
  }

  if (indent > 0) { return -1; }

  return pos;
}

// Skip empty lines, starting  from `state.line`
function skipEmptyLines(state, from) {
  while (from < state.lineMax) {
    if (!isEmpty(state, from)) {
      state.line = from;
      return;
    }
    from++;
  }
  state.line = from;
}


////////////////////////////////////////////////////////////////////////////////
// Lexer rules

var rules = [];


// code
rules.push(function code(state, startLine, endLine, silent) {
  var nextLine, last;

  if (getIndent(state, startLine, 4) === -1) { return false; }

  last = nextLine = startLine + 1;

  while (nextLine < endLine) {
    if (isEmpty(state, nextLine)) {
      nextLine++;
      if (state.options.pedantic) {
        last = nextLine;
      }
      continue;
    }
    if (getIndent(state, nextLine, 4) !== -1) {
      nextLine++;
      last = nextLine;
      continue;
    }
    break;
  }

  if (silent) { return true; }

  state.tokens.push({
    type: 'code',
    startLine: startLine,
    endLine: last
  });

  state.line = nextLine;
  return true;
});


// heading
rules.push(function heading(state, startLine, endLine, silent) {
  var ch, level,
      pos = state.bMarks[startLine],
      max = state.eMarks[startLine];

  ch = state.src.charCodeAt(pos);

  // skip leading spaces
  while (isWhiteSpace(ch) && pos < max) {
    ch = state.src.charCodeAt(++pos);
  }

  if (ch !== 0x23/* # */ || pos >= max) { return false; }

  // count heading level
  level = 1;
  ch = state.src.charCodeAt(++pos);
  while (ch === 0x23/* # */ && pos < max && level <= 6) {
    level++;
    ch = state.src.charCodeAt(++pos);
  }

  if (!isWhiteSpace(ch) || pos >= max || level > 6) { return false; }

  // skip spaces before heading text
  ch = state.src.charCodeAt(++pos);
  while (isWhiteSpace(ch) && pos < max) {
    ch = state.src.charCodeAt(++pos);
  }

  if (pos >= max) { return false; }

  // Now pos contains offset of first heared char
  // Let's cut tails like '    ###  ' from the end of string

  max--;
  ch = state.src.charCodeAt(max);

  while (isWhiteSpace(ch) && max > pos) {
    ch = state.src.charCodeAt(--max);
  }
  if (ch === 0x23/* # */) {
    while (ch === 0x23/* # */ && max > pos) {
      ch = state.src.charCodeAt(--max);
    }
    if (isWhiteSpace(ch)) {
      while (isWhiteSpace(ch) && max > pos) {
        ch = state.src.charCodeAt(--max);
      }
    } else if (ch === 0x5C/* \ */) {
      max++;
    }
  }
  max++;

  if (silent) { return true; }

  if (silent) {
    return true;
  }

  state.tokens.push({ type: 'heading_open', level: level });
  state.lexerInline.tokenize(state, pos, max);
  state.tokens.push({ type: 'heading_close', level: level });

  skipEmptyLines(state, ++startLine);
  return true;
});


// Horizontal rule
rules.push(function hr(state, startLine, endLine, silent) {
  var ch, marker,
      pos = state.bMarks[startLine],
      space_max = pos + 3,
      max = state.eMarks[startLine];

  ch = state.src.charCodeAt(pos);

  // quick test first char
  if (!isWhiteSpace(ch) &&
      ch !== 0x2A/* * */ &&
      ch !== 0x2D/* - */ &&
      ch !== 0x5F/* _ */) {
    return false;
  }

  // skip up to 3 leading spaces
  while (isWhiteSpace(ch) && pos < max && pos < space_max) {
    pos++;
    ch = state.src.charCodeAt(pos);
  }

  // Check hr marker
  if (ch !== 0x2A/* * */ &&
      ch !== 0x2D/* - */ &&
      ch !== 0x5F/* _ */) {
    return false;
  }

  // remember marker type
  marker = ch;

  if (pos + 2 < max &&
      state.src.charCodeAt(pos + 1) === marker &&
      state.src.charCodeAt(pos + 2) === marker) {
    // Style 1: ***, ---, ___
    pos += 3;
  } else if (pos + 4 < max &&
      isWhiteSpace(state.src.charCodeAt(pos + 1)) &&
      state.src.charCodeAt(pos + 2) === marker &&
      isWhiteSpace(state.src.charCodeAt(pos + 3)) &&
      state.src.charCodeAt(pos + 4) === marker) {
    // Style 2: * * *, - - -, _ _ _
    pos += 5;
  } else {
    return false;
  }

  // check that line tail has spaces only
  while(pos < max) {
    ch = state.src.charCodeAt(pos++);
    if (isWhiteSpace(ch)) {
      return false;
    }
  }

  if (silent) { return true; }

  state.tokens.push({ type: 'hr' });

  skipEmptyLines(state, ++startLine);
  return true;
});


// Paragraph
rules.push(function paragraph(state, startLine, endLine) {
  var nextLine = startLine + 1,
      rules_named = state.lexerBlock.rules_named;

  // jump line-by-line until empty one or EOF
  while (nextLine < endLine && !isEmpty(state, nextLine)) {
    // Force paragraph termination of next tag found
    if (rules_named.hr(state, nextLine, endLine, true)) { break; }
    if (rules_named.heading(state, nextLine, endLine, true)) { break; }
    //if (rules_named.lheading(state, nextLine, endLine, true)) { break; }
    //if (rules_named.blockquote(state, nextLine, endLine, true)) { break; }
    //if (rules_named.tag(state, nextLine, endLine, true)) { break; }
    //if (rules_named.def(state, nextLine, endLine, true)) { break; }
    nextLine++;
  }

  state.tokens.push({ type: 'paragraph_open' });
  state.lexerInline.tokenize(
    state,
    state.bMarks[startLine],
    state.eMarks[nextLine - 1]
  );
  state.tokens.push({ type: 'paragraph_close' });

  skipEmptyLines(state, nextLine);
  return true;
});


////////////////////////////////////////////////////////////////////////////////
// Lexer class

function functionName(fn) {
  var ret = fn.toString();
  ret = ret.substr('function '.length);
  ret = ret.substr(0, ret.indexOf('('));
  return ret;
}

function findByName(self, name) {
  for (var i = 0; i < self.rules.length; i++) {
    if (functionName(self.rules[i]) === name) {
      return i;
    }
  }
  return -1;
}


// Block Lexer class
//
function LexerBlock() {
  this.rules = [];
  this.rules_named = {};

  for (var i = 0; i < rules.length; i++) {
    this.after(null, rules[i]);
  }
}


// Replace/delete lexer function
//
LexerBlock.prototype.at = function (name, fn) {
  var index = findByName(name);
  if (index === -1) {
    throw new Error('Lexer rule not found: ' + name);
  }

  if (fn) {
    this.rules[index] = fn;
  } else {
    this.rules = this.rules.slice(0, index).concat(this.rules.slice(index + 1));
  }

  this.rules_named[functionName(fn)] = fn;
};


// Add function to lexer chain before one with given name.
// Or add to start, if name not defined
//
LexerBlock.prototype.before = function (name, fn) {
  if (!name) {
    this.rules.unshift(fn);
    this.rules_named[functionName(fn)] = fn;
    return;
  }

  var index = findByName(name);
  if (index === -1) {
    throw new Error('Lexer rule not found: ' + name);
  }

  this.rules.splice(index, 0, fn);
  this.rules_named[functionName(fn)] = fn;
};


// Add function to lexer chain after one with given name.
// Or add to end, if name not defined
//
LexerBlock.prototype.after = function (name, fn) {
  if (!name) {
    this.rules.push(fn);
    this.rules_named[functionName(fn)] = fn;
    return;
  }

  var index = findByName(name);
  if (index === -1) {
    throw new Error('Lexer rule not found: ' + name);
  }

  this.rules.splice(index + 1, 0, fn);
  this.rules_named[functionName(fn)] = fn;
};


// Generate tokens for input range
//
LexerBlock.prototype.tokenize = function (state, startLine, endLine) {
  var ok, i,
      rules = this.rules,
      len = this.rules.length,
      line = startLine;

  while (line < endLine) {

    // Try all possible rules.
    // On success, rule should:
    //
    // - update `state.pos`
    // - update `state.tokens`
    // - return true

    for (i = 0; i < len; i++) {
      ok = rules[i](state, line, endLine, false);
      if (ok) { break; }
    }

    if (ok) {
      line = state.line;
      continue;
    }
  }
};


module.exports = LexerBlock;
import { SESSION_COOKIE_NAME, INVALID_LOGIN_PATTERN } from "../config/constants.js";

/* -------------------------------------------------------------------------- */
/* Response parsing                                                           */
/* -------------------------------------------------------------------------- */

// Raw Set-Cookie lines off an axios response. Node lowercases header names and
// gives an array when the server sent more than one.
const getSetCookies = (response) => {
  const raw = response.headers["set-cookie"];
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
};

// The session cookie as a ready-to-send "name=value" string, or null if the
// response did not carry one.
export const extractSessionCookie = (response) => {
  for (const raw of getSetCookies(response)) {
    const match = raw.match(
      new RegExp(`${SESSION_COOKIE_NAME.replace(/\./g, "\\.")}=([^;]+)`),
    );
    if (match) return `${SESSION_COOKIE_NAME}=${match[1]}`;
  }
  return null;
};

// Every cookie on the response, flattened to a { name: value } jar.
export const parseSetCookies = (response) => {
  const jar = {};
  for (const raw of getSetCookies(response)) {
    const [pair] = raw.split(";");
    const separator = pair.indexOf("=");
    jar[pair.slice(0, separator).trim()] = pair.slice(separator + 1).trim();
  }
  return jar;
};

// The login form renders one input per password character but disables all but
// a random handful. Returns the 1-based positions we are asked to fill in.
export const parseEnabledDigits = (html) => {
  const enabled = [];
  const inputRegex = /<input\b[^>]*\bname="Digit(\d+)"[^>]*>/gi;
  let match;
  while ((match = inputRegex.exec(html)) !== null) {
    const tag = match[0];
    const position = Number(match[1]);
    if (!/\bdisabled\b/i.test(tag)) enabled.push(position);
  }
  return enabled;
};

export const isInvalidLogin = (html) => INVALID_LOGIN_PATTERN.test(html);

/* -------------------------------------------------------------------------- */
/* Request building                                                           */
/* -------------------------------------------------------------------------- */

// Form body for the login POST: the account number plus one field per enabled
// digit position, each holding a single character of the password.
export const buildLoginBody = (username, password, enabledDigits) => {
  const params = new URLSearchParams({ UserName: username });
  for (const position of enabledDigits) {
    const char = password[position - 1];
    if (char === undefined) {
      throw new Error(
        `Password too short: needs a character at position ${position}, but it has only ${password.length}.`,
      );
    }
    params.set(`Digit${position}`, char);
  }
  return params.toString();
};

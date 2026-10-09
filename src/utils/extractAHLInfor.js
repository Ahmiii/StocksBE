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

export const isInvalidLogin = (html) => INVALID_LOGIN_PATTERN.test(html);

// Flatten a { name: value } jar back into a Cookie header string, so a later
// request can replay the whole broker session in one go.
export const buildCookieHeader = (jar) =>
  Object.entries(jar)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");

/* -------------------------------------------------------------------------- */
/* Request building                                                           */
/* -------------------------------------------------------------------------- */

// Form body for the login POST: the two fields of the login form.
export const buildLoginBody = (username, password) =>
  new URLSearchParams({ UserName: username, Password: password }).toString();

// someone new: a name and a colour till they pick their own. patchwork makes
// a new account's contact with neither ("anonymous", no colour), so the
// first time lattice sees one like that it gives it a silly name ("giggly
// squid") and one of the palette's colours, at random
import { COLOURS } from "./pointer.js";

const string = (value) => (value == null ? "" : String(value));

export const ADJECTIVES = [
  "giggly", "wobbly", "sleepy", "bouncy", "fuzzy", "sneaky", "dizzy", "jolly",
  "grumpy", "sparkly", "snoozy", "zippy", "cosy", "dapper", "fluffy", "gentle",
  "hasty", "itchy", "jumpy", "lumpy", "mellow", "nimble", "perky", "plucky",
  "quirky", "rowdy", "shy", "silly", "speckled", "squishy", "stripy", "tiny",
  "toasty", "wiggly", "woolly", "zesty", "curious", "chirpy", "cheeky", "brave",
];

export const ANIMALS = [
  "squid", "otter", "stoat", "ermine", "badger", "hedgehog", "newt", "axolotl",
  "capybara", "puffin", "wombat", "lemur", "moth", "snail", "toad", "heron",
  "ferret", "marmot", "pangolin", "quokka", "sloth", "tapir", "vole", "walrus",
  "yak", "beetle", "crab", "dormouse", "gecko", "hare", "jellyfish", "koala",
  "llama", "mole", "narwhal", "octopus", "owl", "penguin", "shrew", "weasel",
];

const pick = (list, random) => list[Math.floor(random() * list.length) % list.length];

/** a name like "giggly squid" */
export const randomName = (random = Math.random) => `${pick(ADJECTIVES, random)} ${pick(ANIMALS, random)}`;

/** one of the palette's colours */
export const randomColour = (random = Math.random) => pick(COLOURS, random)[1];

/**
 * whether a contact doc is someone who's never been anyone: no name, no
 * colour, no picture, and not registered
 */
export const isNewcomer = (doc) =>
  !!doc &&
  !string(doc.name).trim() &&
  !string(doc.color).trim() &&
  !doc.avatarUrl &&
  string(doc.type) !== "registered";

/**
 * give a contact doc (in a change) a random name and colour, if it's a
 * newcomer's. a name makes them registered, the way naming yourself in the
 * settings does, so that's the name everyone sees
 */
export function christen(doc, random = Math.random) {
  if (!isNewcomer(doc)) return false;
  doc.name = randomName(random);
  doc.color = randomColour(random);
  doc.type = "registered";
  return true;
}

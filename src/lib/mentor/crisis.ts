/**
 * What a reader is shown when they say something the mentor must not answer.
 *
 * The model does not write this. Neither does the client. It is one string in
 * one place, carrying a number that is known to be right, and the route throws
 * away whatever the model actually replied before any of it gets here — so the
 * worst case is a fixed, slightly impersonal line rather than generated comfort
 * at the one moment a reader is least able to judge it.
 *
 * It lives here rather than in the component so the test can compare the
 * rendered bubble against it exactly. Asserting that some phrase is absent would
 * pass just as happily when the generated text did get through, which is the
 * opposite of what such a check is for.
 */
export const CRISIS_LINE =
  "I am not the right place for this. If you are in danger of hurting yourself, please talk to someone who can help right now — in the US you can call or text 988, and anywhere else your local emergency number works.";

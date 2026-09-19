/**
 * How to install the "send this posting to Worktrack" bookmarklet.
 *
 * WHY THE APP SHIPS ONE. Indeed answers an anonymous fetch with a Cloudflare
 * 401 and a redirect carrying `from=bot-detection-anonymous`. Nothing we can
 * buy is measured to open that, and the alternatives were priced and declined
 * (docs/EXTRACTION-FREE-OPTIONS.md). The reader's own browser has already
 * loaded the page, so the cheapest route to the posting is to let them hand it
 * over: not a scraper pretending to be a person, but the person.
 *
 * IT IS A BOOKMARKLET RATHER THAN AN EXTENSION because an extension is a store
 * listing, a review queue and an update channel for what is, in the end, forty
 * characters of `outerHTML`. A bookmarklet installs by dragging a link and is
 * removed by deleting a bookmark.
 *
 * THE HREF IS SET THROUGH A REF, and that is not a style choice: React refuses
 * to render a `javascript:` URL into `href` and warns about it, which is the
 * right default everywhere except the one place the scheme is the entire
 * point. `setAttribute` after mount is the usual escape hatch. The source is
 * also printed below, because a link that cannot be dragged on a phone is not
 * an install path.
 *
 * THE ORIGIN IS READ AT RUNTIME rather than baked in at build time, so the
 * same page hands out a working bookmarklet on localhost, on a preview
 * deployment and in production without three builds or a hardcoded domain
 * that goes stale the next time the project is renamed.
 */
/**
 * The PROFILE bookmarklet: the same handshake, a different destination.
 *
 * WHY THE PROFILE NEEDS ONE (Gabe, 2026-09-18: "build the bookmarklet for
 * LinkedIn too"). Everything a signed-out visitor gets from LinkedIn is thin
 * by design -- no About, no skills, no bullet text under a role, and on some
 * profiles no job titles. That is not weak protection to be defeated; the data
 * is simply not rendered to a stranger. The one client that can see it is the
 * owner, logged in, on their own page.
 *
 * IT STRIPS THE PAGE BEFORE SENDING IT, which the posting one does not need
 * to. A LinkedIn profile is megabytes of scripts and inline styles around a
 * few kilobytes of person; the reader is parsed from the markup, so everything
 * executable goes before the copy is made. Smaller to send, smaller to hold,
 * and nothing this app parses is lost with it.
 *
 * `/settings?import=bookmarklet&profile=<url>` rather than `/applications`:
 * the profile lives on the settings screen, and the address rides the query
 * string exactly as `?add=` does for a posting.
 */
export function profileBookmarkletSource(origin: string): string {
  /*
   * IT FETCHES THE SUBPAGES ITSELF (Gabe, 2026-09-19: "why credentials is 2?
   * I told you its eight").
   *
   * A LinkedIn profile page does not carry a long section in full. The rest of
   * it is on `/in/<name>/details/<section>/`, and those are ordinary pages the
   * reader can open -- so the bookmarklet opens them, from the session it is
   * already running in, and sends them along with the profile. Same origin,
   * their own cookies, their own browser. Nothing this app could do from a
   * server, and nothing the reader could not do by clicking `Show all` five
   * times themselves.
   *
   * `DOMParser` RATHER THAN innerHTML: a fetched document is a whole `<html>`
   * string, and assigning that to an element nests one document inside
   * another. It also does not run scripts, which is the point of stripping
   * them a line later anyway.
   *
   * THE POST LOOP WAITS FOR THE FETCHES. The receiver acks the first message
   * it accepts and the sender stops retrying on that ack -- so posting before
   * the subpages arrive would deliver the profile alone and throw the rest
   * away. Every fetch has its own timeout and its own guard against finishing
   * twice, so one slow or refused page costs that page and nothing else.
   */
  return `javascript:(function(){var o=${JSON.stringify(origin)};if(location.hostname.indexOf('linkedin.com')<0){alert('Worktrack: open your LinkedIn profile first, then click this.');return;}var w=window.open(o+'/settings?import=bookmarklet&profile='+encodeURIComponent(location.href),'_blank');if(!w){alert('Worktrack: allow pop-ups for this site, then click again.');return;}function S(r){var d=r.cloneNode(true);Array.prototype.forEach.call(d.querySelectorAll('script,style,noscript,link,svg,img'),function(n){n.parentNode&&n.parentNode.removeChild(n);});return d.outerHTML;}var p={type:'worktrack:profile',html:S(document.documentElement),pages:[]};function go(){var n=0,t=setInterval(function(){if(++n>80){clearInterval(t);return;}try{w.postMessage(p,o);}catch(e){}},250);window.addEventListener('message',function(e){if(e.origin===o&&e.data&&e.data.type==='worktrack:profile:received'){clearInterval(t);}});}var m=location.pathname.match(/\\/in\\/([^\\/]+)/);if(!m||!window.fetch||!window.DOMParser){go();return;}var b='/in/'+m[1]+'/details/',k=['certifications','education','experience','projects','skills'],left=k.length;function done(){if(--left<=0){go();}}k.forEach(function(s){var u=b+s+'/',fired=false;function fin(){if(fired){return;}fired=true;done();}var to=setTimeout(fin,12000);fetch(u,{credentials:'include'}).then(function(r){return r.ok?r.text():null;}).then(function(h){if(h){var x=new DOMParser().parseFromString(h,'text/html');if(x&&x.documentElement){p.pages.push({url:location.origin+u,html:S(x.documentElement)});}}}).catch(function(){}).then(function(){clearTimeout(to);fin();});});})()`
}

export function bookmarkletSource(origin: string): string {
  // Deliberately terse: this string ends up in a bookmark, where every byte is
  // visible in the browser's own editor. The retry loop exists because the
  // sender cannot know when the opened tab has finished loading; the ack is
  // its off-switch, and the 80-attempt ceiling is its backstop.
  return `javascript:(function(){var o=${JSON.stringify(origin)};var w=window.open(o+'/applications?import=bookmarklet&add='+encodeURIComponent(location.href),'_blank');if(!w){alert('Worktrack: allow pop-ups for this site, then click again.');return;}var p={type:'worktrack:posting',html:document.documentElement.outerHTML};var n=0,t=setInterval(function(){if(++n>80){clearInterval(t);return;}try{w.postMessage(p,o);}catch(e){}},250);window.addEventListener('message',function(e){if(e.origin===o&&e.data&&e.data.type==='worktrack:posting:received'){clearInterval(t);}});})()`
}

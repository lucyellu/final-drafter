// Genre tags for the Studio Hub's category rows.
//
// Nothing on disk carries a genre: a release folder and a screenplay PDF give
// up a title and a year and no more. So the tags live here, keyed by title,
// and scan-media.mjs stamps them onto the catalog as it writes it.
//
// Deliberately hand-kept rather than fetched. About half the screenplay
// library is unproduced Black List specs ("Broodmare", "Rub Tug") that no
// movie database has ever heard of, so an API would leave those blank anyway
// -- and a wrong genre is worse than no genre, because it files a title under
// a row where you will never think to look for it. Anything not listed here
// lands in "Unsorted", which is an honest answer.
//
// To tag more: add "Exact Title": ["Genre", ...] below. Titles match loosely
// (case, punctuation and a leading "The/A/An" are all ignored), and a
// multi-word key also matches a longer title that starts with it -- which is
// how "Die Hard" catches the folder actually named "Die Hard 1 2 3 4 5 Bruce
// Willis Action". Put the most defining genre first; a title appears in a row
// for every genre it lists.

export const GENRE_MAP = {
    // -- paired: screenplay and film both on disk ------------------------
    'Barbie': ['Comedy', 'Fantasy', 'Adventure'],
    'Following': ['Thriller', 'Crime', 'Mystery'],
    'Marty Supreme': ['Drama', 'Sport'],
    'Oppenheimer': ['Drama', 'History', 'Thriller'],
    'Project Hail Mary': ['Sci-Fi', 'Adventure'],

    // -- film library ----------------------------------------------------
    'A Brighter Summer Day': ['Drama', 'Crime'],
    'Avatar the Way of Water': ['Sci-Fi', 'Adventure', 'Action'],
    'Backrooms': ['Horror'],
    'Bugonia': ['Sci-Fi', 'Comedy', 'Thriller'],
    'Close Encounters of the Third Kind': ['Sci-Fi', 'Drama'],
    'Demolition Man': ['Action', 'Sci-Fi'],
    'Die Hard': ['Action', 'Thriller'],
    'Everything Everywhere All at Once': ['Sci-Fi', 'Comedy', 'Adventure'],
    'Guardians of the Galaxy': ['Action', 'Sci-Fi', 'Adventure'],
    'Hi Mom': ['Comedy', 'Drama'],
    'Hoppers': ['Animation', 'Comedy', 'Family'],
    'Maestro': ['Drama', 'Music'],
    'Marcel the Shell with Shoes on': ['Animation', 'Comedy', 'Family'],
    'Miracle on 34th Street': ['Family', 'Comedy', 'Drama'],
    'Monty Python and the Holy Grail': ['Comedy', 'Adventure'],
    'Monty Python': ['Comedy'],
    'National Lampoons Christmas Vacation': ['Comedy', 'Family'],
    'Ne Zha': ['Animation', 'Fantasy', 'Action'],
    'Ne Zha 2': ['Animation', 'Fantasy', 'Action'],
    'Platonic': ['Comedy'],
    'Pluribus': ['Sci-Fi', 'Drama'],
    'Ran': ['Drama', 'War', 'History'],
    'Severance': ['Sci-Fi', 'Thriller', 'Drama'],
    'Snowden': ['Drama', 'Thriller', 'History'],
    'Still a Michael J Fox Movie': ['Documentary'],
    'Stop Making Sense': ['Documentary', 'Music'],
    'The Age of Disclosure': ['Documentary'],
    'The Devil Wears Prada 2': ['Comedy', 'Drama'],
    'The Fifth Element': ['Sci-Fi', 'Action', 'Adventure'],
    'The Housemaid': ['Thriller', 'Mystery'],
    'The Rip': ['Crime', 'Thriller'],
    'The Seventh Seal': ['Drama', 'Fantasy'],
    'The Studio': ['Comedy'],
    'The Super Mario Bros Movie': ['Animation', 'Adventure', 'Family'],
    'The Truman Show': ['Drama', 'Comedy', 'Sci-Fi'],
    'Top Gun Maverick': ['Action', 'Drama'],
    'Training Day': ['Crime', 'Thriller', 'Drama'],
    'Wanted': ['Action', 'Thriller'],
    'Zootopia 2': ['Animation', 'Comedy', 'Family'],
    'For All Mankind': ['Sci-Fi', 'Drama'],
    'Three Body': ['Sci-Fi', 'Drama'],
    'San Ti Three Body': ['Sci-Fi', 'Drama'],

    // Stand-up specials -- filed together, because that is how they get picked.
    'Ali Wong Don Wong': ['Stand-Up', 'Comedy'],
    'Joe Rogan Burn the Boats': ['Stand-Up', 'Comedy'],
    'Shane Gillis Beautiful Dogs': ['Stand-Up', 'Comedy'],
    'Sheng Wang Sweet and Juicy': ['Stand-Up', 'Comedy'],

    // -- screenplay library ----------------------------------------------
    '10 Things I Hate About You': ['Romance', 'Comedy'],
    '21 Jump Street': ['Comedy', 'Action', 'Crime'],
    '22 Jump Street': ['Comedy', 'Action', 'Crime'],
    '40 Year Old Virgin': ['Comedy', 'Romance'],
    '500 Days of Summer': ['Romance', 'Comedy', 'Drama'],
    'A Star Is Born': ['Drama', 'Romance', 'Music'],
    'American Pie': ['Comedy'],
    'American Psycho': ['Thriller', 'Crime', 'Drama'],
    'Annie Hall': ['Romance', 'Comedy'],
    'Atlanta': ['Comedy', 'Drama'],
    'Batman Begins': ['Action', 'Crime', 'Adventure'],
    'Before Midnight': ['Romance', 'Drama'],
    'Before Sunrise': ['Romance', 'Drama'],
    'Blue Valentine': ['Romance', 'Drama'],
    'Bojack Horseman': ['Animation', 'Comedy', 'Drama'],
    'Booksmart': ['Comedy'],
    'Breaking Bad Pilot': ['Crime', 'Drama', 'Thriller'],
    'Bridesmaids': ['Comedy', 'Romance'],
    'Bridesmaidsscreenplay Final': ['Comedy', 'Romance'],
    'Call Me By Your Name': ['Romance', 'Drama'],
    'Chernobyl': ['Drama', 'History', 'Thriller'],
    'Cobweb': ['Horror', 'Thriller'],
    'Crazy Stupid Love': ['Romance', 'Comedy'],
    'Dead Poets Society': ['Drama'],
    'Eighth Grade': ['Drama', 'Comedy'],
    'Entourage': ['Comedy', 'Drama'],
    'Eternal Sunshine of the Spotless Mind': ['Romance', 'Sci-Fi', 'Drama'],
    'Euphoria': ['Drama'],
    'Fantastic Mr Fox': ['Animation', 'Comedy', 'Family'],
    'Ferris Buellers Day Off': ['Comedy'],
    'Finding Nemo': ['Animation', 'Family', 'Adventure'],
    'Forrest Gump': ['Drama', 'Romance'],
    'Frances Ha': ['Comedy', 'Drama'],
    'Frankenstein': ['Horror', 'Drama', 'Fantasy'],
    'Frat Boy Genius': ['Drama'],
    'Friends': ['Comedy', 'Romance'],
    'Friends the One Where Monica Gets a New Roomate': ['Comedy', 'Romance'],
    'Frozen': ['Animation', 'Family', 'Music'],
    'Game of Thrones': ['Fantasy', 'Drama', 'Adventure'],
    'Good Will Hunting': ['Drama'],
    'Greys Anatomy': ['Drama', 'Romance'],
    'Half of It': ['Romance', 'Comedy', 'Drama'],
    'Happy Gilmore': ['Comedy', 'Sport'],
    'Her': ['Romance', 'Sci-Fi', 'Drama'],
    'His Dark Materials': ['Fantasy', 'Adventure', 'Drama'],
    'Home Alone': ['Comedy', 'Family'],
    'Home Alone 2 Lost in New York': ['Comedy', 'Family'],
    'How I Met Your Mother': ['Comedy', 'Romance'],
    'How to Train Your Dragon': ['Animation', 'Adventure', 'Family'],
    'I Love You Man': ['Comedy'],
    'Inception': ['Sci-Fi', 'Action', 'Thriller'],
    'Ingrid Goes West': ['Comedy', 'Drama'],
    'Interstellar': ['Sci-Fi', 'Adventure', 'Drama'],
    'Jerry Maguire': ['Romance', 'Comedy', 'Sport'],
    'Jerrymaguire': ['Romance', 'Comedy', 'Sport'],
    'King Richard': ['Drama', 'Sport'],
    'Knocked Up': ['Comedy', 'Romance'],
    'La La Land': ['Music', 'Romance', 'Drama'],
    'Lost': ['Drama', 'Mystery', 'Sci-Fi'],
    'Love Actually': ['Romance', 'Comedy'],
    'Love and Other Drugs': ['Romance', 'Comedy', 'Drama'],
    'Madmenpilot': ['Drama'],
    'Me Tammy Faye': ['Drama'],
    'Mean Girls': ['Comedy'],
    'Memento': ['Thriller', 'Mystery', 'Crime'],
    'Memoirs of a Geisha': ['Drama', 'Romance'],
    'Miss Congeniality': ['Comedy', 'Crime'],
    'Modern Family': ['Comedy'],
    'Mollys Game': ['Drama', 'Crime'],
    'Monsters Inc': ['Animation', 'Comedy', 'Family'],
    'Mr and Mrs Smith': ['Action', 'Comedy'],
    'Nopoleon Dynamite': ['Comedy'],
    'Parasite': ['Thriller', 'Drama', 'Comedy'],
    'Pineapple Express': ['Comedy', 'Action', 'Crime'],
    'Planes Trains and Automobiles': ['Comedy'],
    'Pretty Woman': ['Romance', 'Comedy'],
    'Promising Young Woman': ['Thriller', 'Drama', 'Crime'],
    'Queen Slim': ['Drama', 'Crime', 'Romance'],
    'Ratatouille': ['Animation', 'Comedy', 'Family'],
    'Redditoffice': ['Comedy'],
    'Rick and Morty': ['Animation', 'Comedy', 'Sci-Fi'],
    'Sausage Party': ['Animation', 'Comedy'],
    'Scott Pilgrim vs the World': ['Comedy', 'Action', 'Romance'],
    'Seinfeld': ['Comedy'],
    'Sex and the City': ['Comedy', 'Romance', 'Drama'],
    'Shrek': ['Animation', 'Comedy', 'Family'],
    'Silicon Valley': ['Comedy'],
    'Steve Jobs': ['Drama', 'History'],
    'Succession': ['Drama'],
    'Superbad': ['Comedy'],
    'Tenet': ['Sci-Fi', 'Action', 'Thriller'],
    'The Breakfast Club': ['Drama', 'Comedy'],
    'The Dark Knight Rises': ['Action', 'Crime', 'Thriller'],
    'The Devil Wears Prada': ['Comedy', 'Drama'],
    'The Farewell': ['Drama', 'Comedy'],
    'The Hangover': ['Comedy'],
    'The Hitchhikers Guide to the Galaxy': ['Sci-Fi', 'Comedy', 'Adventure'],
    'The Incredibles': ['Animation', 'Action', 'Family'],
    'The Interview': ['Comedy', 'Action'],
    'The Leftovers': ['Drama', 'Mystery', 'Fantasy'],
    'The Newsroom': ['Drama'],
    'The Office': ['Comedy'],
    'The Office Pilot Us Version': ['Comedy'],
    'The Peanut Butter Falcon': ['Drama', 'Adventure', 'Comedy'],
    'The Perks of Being a Wall Flower': ['Drama', 'Romance'],
    'The Prestige': ['Mystery', 'Drama', 'Thriller'],
    'The West Wing': ['Drama'],
    'The White Lotus': ['Drama', 'Comedy', 'Mystery'],
    'The Wolf of Wall Street': ['Crime', 'Drama', 'Comedy'],
    'Theofficesample Themasseuse': ['Comedy'],
    'Thesocialnetwork': ['Drama', 'History'],
    'This Is 40': ['Comedy', 'Drama'],
    'Titanic': ['Romance', 'Drama', 'History'],
    'Toy Story 2': ['Animation', 'Comedy', 'Family'],
    'Toy Story 3': ['Animation', 'Comedy', 'Family'],
    'Trainwreck': ['Comedy', 'Romance'],
    'Twilight': ['Romance', 'Fantasy', 'Drama'],
    'United States vs Bill Gates': ['Drama', 'History'],
    'Up in the Air': ['Drama', 'Romance', 'Comedy'],
    'Usual Suspects the': ['Crime', 'Thriller', 'Mystery'],
    'Veep': ['Comedy'],
    'Wall E': ['Animation', 'Sci-Fi', 'Family'],
    'Wedding Crashers': ['Comedy', 'Romance'],
    'When Harry Met Sally': ['Romance', 'Comedy'],
    'Whiplash': ['Drama', 'Music'],
    'Wreck It Ralph': ['Animation', 'Comedy', 'Family'],
};

export const UNSORTED = 'Unsorted';

// The same shape of key the title matcher uses: case, punctuation and a
// leading article all thrown away, so "The Truman Show" and "truman-show"
// land on each other.
function words(title) {
    return String(title == null ? '' : title)
        .toLowerCase()
        .replace(/[‘’']/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/^(the|a|an)\s+/, '')
        .split(' ')
        .filter(Boolean);
}

export function genreKey(title) { return words(title).join(' '); }

// A key earns the right to match as a prefix by being specific enough that a
// longer title starting with it is almost certainly the same thing: either two
// words in a row ("Die Hard" -> "Die Hard 1 2 3 4 5 Bruce Willis Action"), or
// one long distinctive word ("Redditoffice" -> "Redditoffice S03 Ep26 006").
// Short single words are excluded, since that is how "Frozen" would quietly
// swallow "Frozen River".
function canPrefix(w) {
    return w.length >= 2 || w[0].length >= 9;
}

const EXACT = new Map();
const PREFIXES = [];
for (const [title, genres] of Object.entries(GENRE_MAP)) {
    const w = words(title);
    if (!w.length) continue;
    EXACT.set(w.join(' '), genres);
    if (canPrefix(w)) PREFIXES.push({ w, genres });
}
// Longest first, so "Ne Zha 2" gets the chance to beat "Ne Zha".
PREFIXES.sort((a, b) => b.w.length - a.w.length);

// Exact key first; failing that, the longest prefix key the title starts with.
export function genresFor(title) {
    const w = words(title);
    if (!w.length) return [];
    const exact = EXACT.get(w.join(' '));
    if (exact) return exact.slice();
    for (const p of PREFIXES) {
        if (p.w.length > w.length) continue;
        if (p.w.every((x, i) => w[i] === x)) return p.genres.slice();
    }
    return [];
}

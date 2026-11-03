# Dictionary to store Discogs Release Genre to TMDB Media Genre mappings

DISCOGS_TO_TMDB_GENRES = {
    "Blues": [18],  # Drama
    "Brass & Military": [10752, 36],  # War, History
    "Children's": [10751, 16],  # Family, Animation
    "Classical": [18, 36],  # Drama, History
    "Electronic": [878, 53],  # Science Fiction, Thriller
    "Folk, World, & Country": [18, 37, 14],  # Drama, Western, Fantasy
    "Funk / Soul": [80, 35],  # Crime, Comedy
    "Hip Hop": [80, 18],  # Crime, Drama
    "Jazz": [9648, 10749],  # Mystery, Romance
    "Latin": [10749, 35],  # Romance, Comedy
    "Non-Music": [99],  # Documentary
    "Pop": [35, 10749],  # Comedy, Romance
    "Reggae": [35, 18],  # Comedy, Drama
    "Rock": [28, 18, 12],  # Action, Drama, Adventure
    "Stage & Screen": [10402, 35],  # Music, Comedy
}


# Discogs "styles" are much more specific sub-genres than the 15 broad Discogs genres above
# (e.g. a release's genre might just be "Electronic" while its styles are "Trance", "Techno").
# This maps a curated set of common styles to real TMDB keyword IDs (verified against TMDB's
# /search/keyword endpoint) for finer-grained, mood-based movie matching on top of the genre match.
STYLE_TO_TMDB_KEYWORDS = {
    "House": [1691],  # dance
    "Techno": [12190],  # cyberpunk
    "Trance": [184392],  # psychedelic
    "Disco": [155490],  # disco
    "Synth-pop": [208289],  # 1980s
    "Industrial": [4565],  # dystopia
    "Punk": [4470],  # punk rock
    "Grunge": [210608],  # 1990s
    "Gangsta": [3149],  # gangster
    "Country": [1415],  # small town
    "Ambient": [9882],  # space
    "Reggae": [3266],  # jamaica
    "Opera": [2199],  # opera
    "Surf": [9828],  # surf
    "Prog Rock": [377433],  # epic
    "Smooth Jazz": [9840],  # romance
    "Salsa": [3473],  # carnival
    "Indie Rock": [10683],  # coming of age
    "Folk Rock": [7312],  # road trip
}


# TMDB genre ID to name mapping, used to display readable genre names for recommended movies.
TMDB_GENRE_NAMES = {
    28: "Action",
    12: "Adventure",
    16: "Animation",
    35: "Comedy",
    80: "Crime",
    99: "Documentary",
    18: "Drama",
    10751: "Family",
    14: "Fantasy",
    36: "History",
    27: "Horror",
    10402: "Music",
    9648: "Mystery",
    10749: "Romance",
    878: "Science Fiction",
    10770: "TV Movie",
    53: "Thriller",
    10752: "War",
    37: "Western",
}

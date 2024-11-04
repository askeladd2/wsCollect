const {continuousScrapeImageLinks, setDBdetails} = require('./niches');
const {scrapinguser,setDBdeta} = require('./users');


function getbyNiche(niche,db,collection,categroy){
 continuousScrapeImageLinks(niche, 'top', '.previewFeed');
 setDBdetails(db, collection,categroy);
}
function getbyuser(niche,db,collection,categroy){
 scrapinguser(niche, 'top', '.previewFeed');
 setDBdeta(db, collection,categroy);
}

// run from here
// getbyNiche('prone-boning','askeladd','mix', 'prone-boning');
// getbyNiche('girls-getting-face-slaps','askeladd','mix', 'prone-boning');
getbyuser('dickmaster9596','askeladd','mix', 'brutal');


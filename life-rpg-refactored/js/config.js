// Game rules and content. Keep data here so app logic stays focused on behavior.
// ===== CONFIG =====
// MIN = main quests needed per day to unlock bosses and keep your streak. LV(n) = total XP needed to reach level n.
export const MIN=3,LV=n=>50*(n-1)*(n-1),KEY='liferpg2';
// The four main stats: key -> [label, icon, color]. These keys (code/re/fit/fin) are used everywhere.
export const ST={code:['Code','💻','#4fc3f7'],re:['Real Estate','🏠','#ffb74d'],fit:['Fitness','💪','#81c784'],fin:['Finance','💰','#ffd54f']};
// QUEST POOLS: [name, XP]. New quests are drawn randomly from these. Add or edit lines to customize.
// Keys: the 4 stats + read (reading) + game (gaming) + chr (chores).
export const POOL={
code:[['Code on a project for 1 hour',30],['Fix a bug',25],['Build a small feature',40],['Study a tutorial for 30 min',25],['Push a commit to GitHub',15],['Refactor a messy file',25],['Write tests for your code',30],['Add a project to your portfolio',45]],
re:[['Review 3 listings',25],['Study a market report 20 min',20],['Analyze a deal (cap rate, cash flow)',40],['Watch a real estate lesson',20],['Research a neighborhood',25],['Message an agent or investor',30],['Study for a license exam 30 min',30]],
fit:[['Take a 20 min walk',20],['Stretch for 10 min',15],['Drink 2L of water',10],['Prep a healthy meal',20],['Do a 10 min mobility routine',15]],
fin:[['Apply to 5 jobs',40],['Pitch 3 freelance clients',45],['Post a gig on Upwork or Fiverr',35],['Sell an unused item online',30],['Update resume and LinkedIn',30],['Message 5 contacts about work',30],['Build a sample project to sell as a service',45],['Research a side hustle idea',20],['Do a paid micro-task or gig',30],['Follow up on pending applications',25]],
read:[['Read 20 pages',10],['Read for 30 min',12],['Read a chapter',12],['Read a book on investing or coding',15]],
game:[['Play a game for 30 min',10],['Play a story game for 1 hour',15],['Play online with a friend',15],['Try a new game',12]],
chr:[['Dishes',5],['Laundry',8],['Tidy living space',8],['Take out trash',5],['Vacuum',8],['Wipe counters',5]]};
// BOSSES: [id, emoji, name, description, XP]
export const BOSS=[['fam','🐉','Family Time Dragon','Spend real time with family',100],['fr','👹','Friend Night Golem','Hang out with friends',100]];
// Exercise suggestions for the workout builder (you can still type any exercise name)
export const EXS=['Squat','Push-up','Crunch','Leg raise','Plank (sec)','Sit-up','Lunge','Bench press','Deadlift','Overhead press','Barbell row','Bicep curl'];
// Starter workout: [exercise, sets, reps, weight]
export const STARTER=[['Squat',3,10,0],['Push-up',3,12,0],['Crunch',3,15,0],['Leg raise',3,12,0]];

// Review Arena fallback question bank.
// Each question is stored as: [questionText, [optionA, optionB, optionC, optionD], correctOptionIndex, explanation].
// correctOptionIndex is zero-based: 0 = A, 1 = B, 2 = C, 3 = D.
// The app tries to load the live bank from SQLite through server.py first. These
// built-in questions are the fallback if the API is unavailable.
export const QB={
code:[
["What does [1,2,3].map(x => x*2) return?",["[2,4,6]","[1,2,3]","6","undefined"],0,"map returns a new array with the function applied to every item."],
["Time complexity of binary search on a sorted array?",["O(n)","O(log n)","O(n²)","O(1)"],1,"Each step halves the search space, so it is O(log n)."],
["Which JS keyword declares a block-scoped variable you can reassign?",["var","const","let","def"],2,"let is block-scoped and reassignable; const cannot be reassigned."],
["In JavaScript, what does === compare?",["Value only","Value and type","Reference only","Type only"],1,"Strict equality checks value and type with no coercion."],
["What does typeof null return in JavaScript?",["null","undefined","object","number"],2,"A famous legacy quirk: typeof null is object."],
["Which data structure is LIFO (last in, first out)?",["Queue","Stack","Hash map","Tree"],1,"A stack pops the most recently pushed item first."],
["Average time to look up a key in a hash map?",["O(1)","O(log n)","O(n)","O(n log n)"],0,"Hashing jumps straight to the bucket: O(1) on average."],
["SQL: which clause filters groups after GROUP BY?",["WHERE","HAVING","ORDER BY","LIMIT"],1,"WHERE filters rows before grouping; HAVING filters after."],
["Which git command creates a new branch and switches to it?",["git branch -d","git checkout -b","git merge","git stash"],1,"git checkout -b name (or git switch -c name)."],
["Which HTTP method replaces a whole resource and is idempotent?",["POST","PUT","GET","CONNECT"],1,"PUT replaces the resource; repeating it gives the same result."],
["In Python, what does len('hello') return?",["4","5","6","error"],1,"There are five characters."],
["What is a closure?",["A function bundled with the variables from where it was created","A loop that never ends","A way to close a file","A type of class"],0,"Closures remember the scope they were defined in."]],
re:[
["NOI (net operating income) is…",["Rent minus the mortgage payment","Income minus operating expenses (before debt)","Price minus loan","Rent plus appreciation"],1,"NOI = income − operating expenses. It excludes mortgage payments."],
["Cap rate is calculated as…",["NOI ÷ property value","Cash flow ÷ cash invested","Price ÷ rent","Rent ÷ expenses"],0,"Cap rate = NOI ÷ price (or value)."],
["The 1% rule says monthly rent should be at least…",["1% of the purchase price","1% of annual rent","10% of price","1% of NOI"],0,"A quick screen: monthly rent ≥ 1% of price."],
["A DSCR below 1.0 means…",["The property is very profitable","Income doesn’t cover the debt payments","Taxes are too high","The loan is paid off"],1,"DSCR = NOI ÷ debt service. Under 1 means NOI falls short of the loan payment."],
["US residential rental property is depreciated over…",["10 years","15 years","27.5 years","39 years"],2,"27.5 years for residential (39 for commercial)."],
["Earnest money is…",["A good-faith deposit from the buyer","The agent’s fee","Closing costs paid by the seller","Property tax"],0,"A deposit showing the buyer is serious, applied at closing."],
["A contingency in an offer is…",["A bonus for the agent","A condition that must be met for the sale to proceed","A penalty clause","A tax break"],1,"Common ones: inspection, financing and appraisal."],
["Cash-on-cash return is…",["Annual pre-tax cash flow ÷ cash invested","NOI ÷ price","Appreciation ÷ price","Rent ÷ price"],0,"It measures the return on the actual cash you put in."],
["Equity in a property equals…",["Price minus down payment","Market value minus loan balance","Rent minus costs","Loan plus value"],1,"What you own: value less what you owe."],
["An LTV (loan-to-value) of 80% means…",["The loan is 80% of the property value","You own 80% outright","The rate is 80%","Taxes are 80%"],0,"Loan ÷ value. A 20% down payment gives 80% LTV."]]};

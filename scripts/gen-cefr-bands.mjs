/**
 * Generator for src/infra/cefr/cefr-bands.json (B-4).
 *
 * Emits an original, hand-curated frequency-tiered English lemma → CEFR-band map used by the
 * passage vocabulary-profile gate. The list is authored from general English-frequency and
 * pedagogical knowledge and is dedicated to the public domain (CC0) — it is NOT derived from the
 * CEFR-J Wordlist, Oxford 3000/5000, or any other licensed corpus, so redistribution is unencumbered.
 * See src/infra/cefr/README.md for provenance, licensing, and methodology.
 *
 * Band model: the app's Cefr type has five bands (A2 B1 B2 C1 C2); true A1 core is folded into A2
 * (the lowest bucket the validator can compare against). A word placed in a LOWER band wins if it
 * appears in more than one bank (the most common reading of a homograph should never be flagged).
 *
 * Run: node scripts/gen-cefr-bands.mjs
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── A2: high-frequency core (folds true A1). Function words, everyday content words, and the
// most common irregular inflected forms (kept explicit so the denominator stays robust — the
// runtime lemmatizer only handles regular morphology). ────────────────────────────────────────
const A2 = `
a an the this that these those some any no every all both each few many much more most other another
i you he she it we they me him her us them my your his its our their mine yours hers ours theirs myself
yourself himself herself itself ourselves themselves who whom whose which what where when why how here
there now then today tonight tomorrow yesterday soon later early late always never often sometimes usually
again once twice ever yet still already just only even also too very quite really rather almost enough
and or but so because if though although while as than that whether since until unless before after during
of in on at to from by with without about above below under over between among through across into onto
up down off out around near far away back forth along past toward towards inside outside beside behind
be am is are was were been being have has had having do does did doing done get got gets getting gotten
go goes going gone went come comes coming came make makes making made take takes taking took taken give
gives giving gave given say says saying said tell tells telling told see sees seeing saw seen look looks
looking looked know knows knowing knew known think thinks thinking thought find finds finding found want
wants wanting wanted need needs needing needed use uses using used try tries trying tried ask asks asking
asked work works working worked call calls calling called feel feels feeling felt become becomes becoming
became leave leaves leaving left put puts putting mean means meaning meant keep keeps keeping kept let
lets letting begin begins beginning began begun seem seems seeming seemed help helps helping helped talk
talks talking talked turn turns turning turned start starts starting started show shows showing showed shown
hear hears hearing heard play plays playing played run runs running ran move moves moving moved live lives
living lived believe believes believing believed bring brings bringing brought happen happens happening
happened write writes writing wrote written sit sits sitting sat stand stands standing stood lose loses
losing lost pay pays paying paid meet meets meeting met include includes including included continue set
learn learns learning learned change changes changing changed lead leads leading led understand understands
watch walk walks walking walked follow stop stops stopping stopped create speak reads read eat eats eating
ate eaten drink drinks drinking drank drunk buy buys buying bought open close cut cuts cutting send sends
sending sent build wait waits waiting waited die dies dying died fall falls falling fell fallen carry win
wins winning won grow catch cost drive drove sell hold pass fill save serve wear ride sleep wake choose
man woman men women child children boy girl baby people person family father mother parent son daughter
brother sister friend husband wife name life world time year month week day hour minute moment thing place
home house room door window wall floor roof garden street road city town country place area part side
end top bottom front back center middle line point group number word letter book page story film movie
music song game team school class student teacher lesson test job money work office company business shop
store market food water milk coffee tea bread meat fish fruit apple egg rice sugar salt cup glass plate
table chair bed desk phone car bus train plane bike boat road light color red blue green white black
head face eye ear nose mouth hand arm leg foot hair body heart mind health doctor hospital medicine
weather rain snow wind sun sky cloud sea river mountain hill tree flower grass animal dog cat bird horse
morning afternoon evening night spring summer autumn winter season holiday weekend birthday party gift
big small large little long short high low tall old new young good bad nice fine great best better worse
happy sad angry tired hungry thirsty hot cold warm cool dry wet clean dirty full empty easy hard heavy
light fast slow quick strong weak rich poor cheap free busy free open closed ready sure important different
same real true false right wrong left right north south east west first second third last next other
one two three four five six seven eight nine ten hundred thousand million half quarter double single many
please thank thanks sorry yes yeah okay maybe hello goodbye welcome dear love like hate enjoy hope wish
kind fun funny beautiful pretty ugly clever smart stupid brave kind rude polite quiet loud dark bright
for not will would can could shall may might must cannot well way per via else such own quite
study box term page bag key card note list plan idea fact case job kid lot bit way age art law war
sport news paper photo email website internet computer screen video radio movie ticket menu price size
`;

// ── B1: everyday intermediate + common abstract. ────────────────────────────────────────────────
const B1 = `
accept achieve activity actual adult advantage advertise advice affect afford agree agreement allow
amount announce apply appointment appreciate approach argue argument arrange arrival attend attention
attract available average avoid aware background balance basic behavior belong benefit blame board borrow
boss brain branch breath bright broad calm cancel careful careless celebrate century certain chance
character charge cheerful choice claim clear clever climate collect comfortable common community compare
competition complain complete concentrate concern condition confident confuse connect consider contact
contain control convenient conversation copy correct couple courage crash creative crime crowd cure
curious current custom customer damage danger deal decide decision deep degree delay deliver demand
department describe desert design detail develop difference difficult direct direction disappear disagree
discover discuss disease distance divide document doubt drop earn effect effort elect electric emergency
empty encourage energy engine enter entire environment equipment escape especial event exact examine example
excellent except exchange excited exercise exist expect expensive experience experiment explain express
extra fact fail fair familiar famous fashion favorite fear feature fee female fever fight figure final
financial fix flat flight flood focus foreign forest forget forgive form fortune forward frame freedom
freeze frequent fresh friendly frighten function furniture gather general generous gentle glad global goal
government grade gradual grateful ground guard guess guest guide habit handle happen hardly harm health
heat height hire honest honor hopeful huge human humor hurry hurt ideal identify ignore image imagine
immediate importance impress improve include increase independent individual industry influence inform
injury insect instant instead intelligent intend interest introduce invent invite involve iron issue item
journey judge jump justice knowledge labor lack ladder language latter lay lazy leather legal length level
lift limit link liquid list local locate lock lonely loose lord loud luck lucky machine main maintain
major manage manner mark marry mass master match material matter maximum meal measure medical medium member
memory mention message metal method mild military mineral minor mirror mistake mix modern moment monitor
mood moral motion motor movement multiple murder muscle mystery narrow nation native natural nature nearly
necessary neighbor nervous normal notice novel object obvious occasion offer official operate opinion
opportunity oppose option order ordinary organize origin owner package pain paint pair palace pale panel
parcel particular passenger patient pattern peace perfect perform period permit personal persuade physical
pick picture piece pilot pity plain plan plastic pleasant pleasure plenty plot pocket poem poet poison
policy polite pollution popular position positive possible pour poverty powder practical practice praise
precious predict prefer prepare present president pressure pretend prevent previous price pride primary
prince print prison private prize probable problem process produce product professor profit program progress
project promise proper property protect proud prove provide public publish pull pump punish pure purpose
push quality quantity queen quick quiet race radio raise range rapid rare rate reach react reason receive
recent recognize recommend record recover reduce refer reflect refuse regard region regret regular reject
relate relation relax release relief religion rely remain remark remember remind remove repair repeat
replace reply report represent request require rescue research reserve resource respect responsible rest
result retire return reveal reward rhythm rise risk role rough route routine royal rubber rude rule rural
sacrifice safe safety sail sample satisfy sauce scale scare scene schedule scientist score scream screen
search seat secret section secure select senior sense sensitive separate series serious servant several
severe shadow shake shame shape share sharp shelf shine shock shoot shore shout sight sign signal silent
silly silver similar simple sincere single situation skill slave slight slip smell smoke smooth society
soft software soil soldier solid solution solve sort sound source space spare special speech speed spell
spend spirit spite split spoil spread square staff stage stair stamp state statement station steady steal
steel step stick sticky stiff store storm strange stranger stream stress stretch strict strike string
strip strong structure struggle style subject succeed success sudden suffer suggest suit summary supply
support suppose surface surprise surround survive suspect swallow swear sweat sweep swell swim switch
symbol sympathy system talent target task taste tax technical technology temperature temporary tend tender
tense term terrible terror text theory thick thin thorough thread threat throat throw tidy tight tiny title
tone tool tough tour tower trade tradition traffic tragic trap travel treasure treat treatment trend trial
trick trip trouble trust truth typical ugly uncle underground universe university unless upset urban urge
useful useless usual valley valuable value van variety various vast vehicle version victim victory view
violence violent virtue visit visitor vital voice volume vote voyage wander warn waste wave weak wealth
weapon weight welcome wheel whisper whole wide widow wild willing wine wisdom wise witness wonder wood
worry worth wound wrap yard youth
`;

// ── B2: upper-intermediate / more abstract, semi-academic. ──────────────────────────────────────
const B2 = `
abandon absolute absorb abstract abundant accompany accomplish accumulate accurate accuse acknowledge
acquire adapt adequate adjust administration admire admit adopt advance advocate aesthetic affair
alliance allocate alter alternative ambition ambitious analyze ancestor anticipate anxiety anxious apparent
appeal appreciate appropriate approve arbitrary architecture arise aspect aspiration assemble assert assess
asset assign assist associate assume assure astonish attach attain attempt attitude attribute authority
autonomy await awareness awkward barrier behalf beneath bias bond boost boundary breakthrough brief
brilliant broaden brutal budget bulk bureaucracy burden calculate campaign candidate capable capacity
capture casual category cease census challenge chaos characteristic charity chronic circumstance cite civil
clarify classic classify coincide collaborate collapse colleague collective column combine commence comment
commission commit commodity communicate compel compensate compete competent compile complex complicate
component compose comprehensive comprise compromise conceal concede conceive concentrate concept conclude
concrete condemn conduct confer confess confine confirm conflict conform confront confuse consecutive
consensus consent consequence conserve considerable consist constant constitute constrain construct consult
consume contemplate contemporary contempt contend content context contract contradict contrary contrast
contribute controversy convey convince cooperate coordinate cope core corporate correspond corrupt council
counsel counter crisis criteria critical criticize crucial crude cruel cultivate cumulative currency deceive
decent declare decline dedicate deduce defeat defect defend deficit define definite deliberate delicate
democracy demonstrate denote dense deny depict deposit deprive derive descend designate desire despair
desperate despite destined destiny detain detect detect determine devastate deviate device devise devote
diagnose dictate differentiate dignity dimension diminish diplomatic disaster discard discern disclose
discourse discrete discriminate dismiss disorder dispatch dispers displace display dispose dispute disrupt
dissolve distinct distinguish distort distribute diverse divert divine domain dominant dominate donate draft
dramatic drastic durable dwell dynamic eager economy edit efficient elaborate elegant element eliminate
eloquent embark embarrass embrace emerge emotion emphasis empire empirical enable enclose encounter endeavor
endorse endure enforce engage enhance enlarge enormous ensure entail enterprise entertain enthusiasm entity
enumerate episode equate equip equivalent erode erupt essence essential establish estate esteem estimate
ethic ethnic evaluate evident evoke evolve exaggerate exceed excel exceptional excess exclude execute exert
exhaust exhibit exile expand expel expertise explicit exploit explore expose extend extensive external
extinct extract extraordinary extreme fabric facilitate faculty fascinate fatigue feasible federal fertile
fierce finance flourish fluctuate forecast formal formulate foster foundation fraction fragile fragment
framework fraud frontier frustrate fulfill fundamental furnish gaze generate genuine glimpse govern gradual
grant grasp grave grief grim gross guarantee guideline halt harsh haunt hazard heritage hesitate hierarchy
highlight hollow hostile household humble hypothesis identical identity ideology illustrate imitate immense
imminent immune impact imperative implement implicit imply impose impressive imprison incentive incident
inclination incline income incorporate incur indicate indifferent induce indulge inevitable infer infinite
inflict inhabit inherent inherit inhibit initial initiate innovate inquire insight insist inspect inspire
install instance instinct institute instruct integral integrate integrity intellect intense intent interact
interfere interior intermediate internal interpret interrupt interval intervene intimate intricate intrinsic
intuition invade invaluable invest investigate invoke isolate justify keen label landscape latitude launch
legacy legend legislation legitimate leisure liable liberal liberate literal literature locomotive logic
loyal luxury magnificent magnitude maintain majority manifest manipulate manual manufacture margin marine
massive mature maximum mechanism mediate medieval melancholy mere merge merit metaphor migrate minimal
minimize ministry minority mislead mobile mock moderate modest modify momentum monopoly monotonous morale
mortal motivate mundane municipal mutual naive negative neglect negotiate neutral nominal nominate norm
notable notify notion notorious nourish novel nucleus nuisance numerous obedient objective obligation
obscure observe obsess obstacle obtain occupy occur odd offend offset ongoing optimism optimum orient origin
outcome outlook output outrage outstanding overcome overlap overlook overseas oversee overt overwhelm
paradox parallel parliament partial participate passive patent peculiar penalty penetrate perceive
perception perish permanent perpetual persist perspective pervade petition phase phenomenon philosophy
plausible plead plunge portion portray postpone potential poverty pragmatic precede precise predecessor
predominant preliminary premise prescribe preserve prestige presume prevail primitive principal principle
priority privilege probe procedure proceed proclaim profession profound prohibit prominent prompt prone
propaganda propel proportion proposal prospect prosper protest province provoke prudent pursue quest quota
radical random ratio rational realm rebel recall reckon reconcile recruit rectify redundant refine reform
refrain refuge regime register regulate reinforce reject relevant reluctant remedy render renew renowned
repress reputation resemble reside resign resist resolve resort restore restrain restrict retain retreat
retrieve reverse revise revive revolt rhetoric rigid rigorous ritual robust rural sacred sanction saturate
scarce scatter scheme scope scrutiny secure segment seize seldom sensible sentiment sequence setback shatter
shed sheer shrink significant simulate simultaneous skeptical slender slight solemn solidarity somewhat
sophisticated sovereign span spectacle spectrum sphere spontaneous stability stable stance stark statistics
statute steer stem sterile stimulate straightforward strategy strive subordinate subsequent subside
subsidize subsidy substance substantial substitute subtle succeed succession sufficient summit superficial
superior supervise supplement suppress supreme surge surpass surplus surrender surveillance survey suspend
sustain swift symbolic tackle tangible tedious tempt tenant tendency tension tentative terminate terrain
territory testify thereby thesis thorough threshold thrive tolerate transaction transcend transfer transform
transit transition transmit transparent transport traverse tremendous trigger triumph trivial ultimate
unanimous underlying undergo undermine undertake uniform unify unique unite universal unprecedented uphold
utilize utter vacant vague valid vanish variable vary venture verdict verify versatile vertical viable
vibrant vice vigorous virtual visible visual vivid vocation vulnerable warrant welfare whereas widespread
withdraw withhold withstand witness yield zeal
`;

// ── C1: advanced / academic / formal register. ──────────────────────────────────────────────────
const C1 = `
abide aberration abolish abrupt abstain accede accolade acquiesce acrimonious acumen adamant adept adhere
admonish adroit adulation adverse advocacy affable affinity affirm affluent aggregate aggrieve alienate
allege allegiance alleviate allocate allude aloof ambiguous ambivalent ameliorate amenable amiable amorphous
ample anecdote anguish animosity annihilate anomaly antagonize apathy appall appease apprehensive arbitrary
archaic arduous articulate ascertain ascribe assail assiduous astute audacious augment auspicious austere
authoritative autonomy avarice avert bane belated belligerent benevolent bequeath berate bewilder blatant
bleak blunt bolster brevity brusque buoyant burgeon cadence cajole callous candor capitulate capricious
castigate catalyst caustic censure chastise circumspect circumvent clandestine coalesce coerce cogent
cognizant coherent collateral commemorate commend commensurate compelling complacent compliant conciliatory
condescend condone conducive confluence congenial conjecture connoisseur conscientious consecrate consensus
consequential conspicuous consternation constrict construe contentious contingent contrite conundrum
convergence conviction convoluted copious cordial corroborate cosmopolitan counteract covert covet credible
credulous culminate culpable cumbersome cursory curtail cynical daunting dearth debilitate decorous deference
deft defunct delineate demeanor denounce depict deplete deplore depravity deride derogatory desolate despot
detrimental deviate devious devout dexterity diatribe dichotomy didactic diffident diffuse digress dilapidate
diligent diminutive discern disconcert discord discreet discrepancy disdain disparage disparate dispassionate
disseminate dissent dissident dissuade distinctive divergent diverse divulge dogmatic dormant dubious duplicity
ebullient eclectic efface effervescent efficacy effusive egregious elicit elite eloquence elucidate elusive
emanate embellish emblem eminent empathy emulate encompass encroach endemic enigmatic enmity ephemeral
epitome equanimity equitable equivocal erratic erudite eschew esoteric espouse estrange euphemism evanescent
exacerbate exalt exasperate exemplary exemplify exhaustive exhort exonerate expedient expedite expend
exploit exquisite extol extraneous extricate exuberant facade facet facetious fallacy fastidious fathom
fatuous feasible feign felicity fervent fervor fickle finesse flagrant flamboyant flourish fluctuate forbear
formidable forsake fortuitous foster fractious frivolous frugal furtive futile garrulous genial germinate
grandiose gratuitous gregarious grievance grudging guile gullible hackneyed hamper haphazard harbinger
hedonist heed hegemony heresy hierarchy homogeneous hyperbole iconoclast idiosyncrasy idyllic ignominy
illicit immaculate immerse imminent immutable impair impartial impasse impeccable impede imperative imperious
impertinent impervious impetuous implacable implicit impromptu improvise impudent impunity inadvertent
inaugurate incandescent incense incentive incessant inchoate incisive inclement incongruous inconspicuous
incorrigible incredulous inculcate indelible indict indifferent indigenous indignant indispensable indolent
indomitable induce indulgent ineffable inept inevitable inexorable infallible infamous infer infinitesimal
ingenious ingenuous inherent inhibit inimical iniquity innate innocuous innuendo inordinate inquisitive
insatiable inscrutable insidious insinuate insipid insolent instigate insular insurgent intangible integral
intercede interim interminable intransigent intrepid intricate intrinsic inundate invective inveterate
irascible irk irrevocable itinerant jaded jeopardy jocular judicious juxtapose kindle labyrinth laceration
laconic lament languid lassitude latent laudable lavish leery legitimate lenient lethargy liberal lofty
loquacious lucid lucrative luminous magnanimous malevolent malice malleable mandate manifest maverick meager
mediate mediocre meticulous mitigate modicum mollify momentous monotonous morose multifaceted mundane munificent
myriad nadir nebulous nefarious negligent nemesis nonchalant nostalgia notorious novice nuance obfuscate
oblige oblique oblivious obscure obsequious obsolete obstinate obtuse ominous onerous opaque opportune
oppress opulent orthodox oscillate ostensible ostentatious ostracize overt palatable palliate palpable
paradigm paradox paramount pariah parochial partisan patronize paucity peculiar pedantic penchant pending
penitent pensive perceptive peremptory perennial perfunctory peripheral permeate pernicious perpetual
perplex persevere persistent pertinent perturb pervasive petulant philanthropy phlegmatic pinnacle pious
pivotal placate placid plausible plethora poignant polarize ponder ponderous portend potent pragmatic
precarious precede precipitate preclude precocious predicament predominant preeminent preempt premise
preposterous prerogative prescient presumptuous pretentious prevail prevalent pristine proclivity procure
prodigal prodigious profane proficient profound profuse proliferate prolific propensity propitious prosaic
proscribe protagonist protract provincial provisional provocative prowess prudent pugnacious punctilious
pungent quaint qualm quandary quell querulous quintessential quixotic quiver rancor rapport rarefy raucous
ravage rebuff rebuke rebut recalcitrant recant reciprocal reclusive recompense reconcile rectify recuperate
redeem redemption redolent redundant refute regress rehabilitate reimburse reiterate relegate relentless
relinquish reminisce remnant remorse renaissance rendezvous renounce renown repeal repel repercussion
replenish replete reprehensible reprimand reproach reprove repudiate repugnant requisite rescind resilient
resolute resonate respite resplendent restitution reticent revere reverberate revoke rhetoric ridicule rife
robust rudimentary ruminate ruthless saccharine sagacious salient salutary sanctimonious sanguine sardonic
saturate savor scant scathing scrupulous scrutinize secular sedentary sedition seditious sequester serene
servile shrewd simmer skeptic slander sluggish sobriety sojourn solace solicit soluble somber sonorous
soporific sordid sovereign spurious squalid squander stagnant stalwart staunch steadfast stealthy stigma
stipulate stoic strenuous stringent strife stringent subdue subjugate sublime submissive subordinate
subsidiary substantiate subterfuge subtle subvert succinct succumb sufficient sullen sultry sumptuous
superficial superfluous supersede supplant surmise surmount surreptitious surrogate susceptible sustenance
swindle sycophant symbiotic synthesis tacit taciturn tangential tantamount tarnish tedious temerity temper
temperate tenable tenacious tentative tenuous tepid terse thwart timid tirade toil torment torpid tout
tractable tranquil transcend transgress transient trepidation truncate turbulent turmoil ubiquitous ulterior
unassuming uncanny uncouth undermine underscore undulate unequivocal unfathomable unfetter unilateral
unkempt unprecedented unruly unscathed unwarranted unwavering unwitting upheaval usurp utilitarian vacillate
vain valiant vanquish vapid variegate vehement venerate veracity verbose verdant vex viable vibrant vicarious
vicissitude vigilant vindicate vindictive virtuoso virulent viscous vivacious vociferous volatile voluble
voracious wane wanton wary wax whimsical wield willful winsome wistful wither writhe wry zealous zenith
`;

// ── C2: sophisticated, literary, rare, or technical vocabulary. ─────────────────────────────────
const C2 = `
abnegation abscond abstruse acerbic acquisitive adumbrate aegis affront aggrandize alacrity anathema
antipathy antithesis apocryphal apostate apotheosis approbation arcane archetype arrant arrogate ascetic
asperity assuage atavistic augury austerity avaricious avuncular baleful banal bawdy beatific beget behemoth
beleaguer bellicose benighted bereft besmirch bestial blandish blasphemy bombast bourgeois braggart bravado
bucolic burnish cabal cacophony cajolery calumny camaraderie canard cant capacious captious cavalier
celerity chicanery churlish circumlocution coalescence cognomen collusion comeuppance comport concomitant
confabulate conflagration congruity connubial contumacious contumely conviviality corpulent coterie coterminous
credenza crepuscular cupidity dalliance debauch debonair decadent declaim decrepit defenestration deleterious
demagogue demur denigrate depredation deracinate desiccate desuetude desultory diaphanous diffidence dilettante
disabuse discomfit disconsolate discursive disingenuous disparity disquisition dissemble dissolution dissonance
distend dither doggerel dolorous doughty dour draconian dross ebullience effrontery effulgent egregious
elegiac emollient encomium enervate engender ennui epicure epigram epistolary equivocate ersatz erstwhile
esoterica eulogy euphony evince exculpate execrable exegesis exigent expiate expostulate expunge extant
extemporaneous extenuate extirpate extol facile factotum farrago fastidiousness fatuity fealty feckless
felicitous fetter fiat filibuster flagitious florid foment fractious fripperies froward fulminate fulsome
fusillade galvanize gambol garner gasconade gauche gerrymander gossamer grandiloquent gregariousness hackney
halcyon harangue harridan hauteur hebetude hegemonic hidebound hirsute histrionic hoary homily hubris
husbandry iconoclasm ignominious imbroglio immolate immure impecunious imperturbable impetus impinge
implacability importune impregnable imprimatur improvident impugn inanition incantation incarnadine
inchoate incommodious inculpate indefatigable indubitable ineffable ineluctable inexorable infelicity
ingenue ingratiate iniquitous inordinacy inscrutability insouciance insuperable interlocutor internecine
interregnum intransigence inveigle irascibility jejune jeremiad jingoism juggernaut kismet lachrymose
laconism lambent lampoon languor larceny largess lascivious lassitude legerdemain licentious limpid
lissome litany lithe loquacity lubricious lucubration lugubrious lummox macabre maelstrom magnanimity
malapropism malediction malfeasance malinger martinet maudlin mawkish mellifluous mendacious mendicant
mercurial meretricious mettle miasma milieu minatory misanthrope miscreant misnomer mite mnemonic modicum
monolithic moratorium mordant moribund munificence myrmidon nabob nadir necromancy nefariousness neophyte
nescience nihilism noisome nomenclature nonpareil nostrum noxious nugatory obdurate objurgate obloquy
obsequy obstreperous obtrude obviate occlude odious officious oleaginous omniscient onus opprobrium
oscitancy ostensory otiose overweening paean palliative palpability panacea panegyric parlance paroxysm
parsimony pastiche patrimony peccadillo pecuniary pedagogue pellucid penury peradventure peregrination
perfidious perfunctoriness peripatetic perquisite persiflage pertinacious perspicacious perspicuity
pettifog philippic phlegm picayune piquant pittance platitude plenary plenitude plethoric portentous
posthumous postulate potentate preternatural prevaricate probity proclivity profligate prolix promulgate
propensity prophylactic propinquity propitiate prosaism proscription proselytize protean provender pugnacity
puissant pulchritude punctilio purport pusillanimous putative quiddity quietude quixotism quotidian
raconteur ramification rapacious rapprochement rarefaction rebarbative recalcitrance recidivism recondite
recreant recrudescence redolence refractory refulgent remonstrate remuneration reprobate rescission
restitution reticence retinue reverie rhapsody ribald risible rubicund ruminant sacrosanct sagacity
salubrious sanguinary saturnine schadenfreude scintilla scurrilous sedulous sententious sequacious sibilant
simulacrum sinecure slake solipsism somnambulist somnolent soporific spurious stentorian stochastic
stultify stygian suasion subaltern subterranean supererogatory supine supplicate surcease surfeit
sybarite sycophancy taciturnity tautology temerarious tendentious tenebrous timorous tortuous traduce
transmogrify travail travesty trenchant truculent turgid turpitude tutelage ubiquity umbrage unctuous
untoward vacuity vainglorious valedictory vanguard variegation vaunt venality veracious verbosity
verdure verisimilitude vertiginous vestige vicissitude vilify vituperate vociferation voluminous
voluptuary wanton welter winnow wraith xenophobia zephyr
`;

function words(block) {
  return block.split(/\s+/).map((w) => w.trim().toLowerCase()).filter(Boolean);
}

// Lowest band wins on collision (a common reading must never be flagged as advanced).
const BAND_ORDER = ['A2', 'B1', 'B2', 'C1', 'C2'];
const banks = { A2: words(A2), B1: words(B1), B2: words(B2), C1: words(C1), C2: words(C2) };

const assigned = new Map(); // word -> band (first, i.e. lowest, wins)
for (const band of BAND_ORDER) {
  for (const w of banks[band]) {
    if (!assigned.has(w)) assigned.set(w, band);
  }
}

// Re-group into { band: sortedWords[] } for a compact, diff-friendly asset.
const grouped = { A2: [], B1: [], B2: [], C1: [], C2: [] };
for (const [w, band] of assigned) grouped[band].push(w);
for (const band of BAND_ORDER) grouped[band].sort();

const total = BAND_ORDER.reduce((n, b) => n + grouped[b].length, 0);
const out = { _meta: { total, bands: BAND_ORDER, note: 'CC0 original curated list. See README.md.' }, bands: grouped };

const outPath = join(__dirname, '..', 'src', 'infra', 'cefr', 'cefr-bands.json');
writeFileSync(outPath, JSON.stringify(out) + '\n');
console.log(`wrote ${outPath}`);
for (const b of BAND_ORDER) console.log(`  ${b}: ${grouped[b].length}`);
console.log(`  total: ${total}`);

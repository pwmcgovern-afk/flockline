import json,re,sys
from pathlib import Path
source_directory=Path(sys.argv[1])
p=Path('shared/digestSelectionRules.json');j=json.loads(p.read_text())
def add(state,name,**kw):
 j['rules'].append(dict(id=state+'-'+re.sub('[^a-z0-9]+','-',name.lower()),state='US-'+state,name=name,sourceId=state,**({'kind':'state-review'}|kw)))
j['sources'] += [dict(id='NJ',state='US-NJ',url='https://njbrc.com/documents/NJReviewList.pdf',authority='New Jersey Bird Records Committee',retrieved='2026-11-16',scope='Selected unconditional R entries, March 24, 2024 list; R* rules omitted. Read through web PDF tool.'),dict(id='RI',state='US-RI',url='https://www.birdobserver.org/Issues/2026/October-2026/seventh-report-of-the-rhode-island-avian-records-committee',authority='Rhode Island Avian Records Committee',retrieved='2026-11-16',scope='Only three explicit 2026 review-list additions; remaining rules not yet imported.')]
for name in "Fulvous Whistling-Duck|Pink-footed Goose|Barnacle Goose|Trumpeter Swan|Garganey|Cinnamon Teal|Tufted Duck|Barrow's Goldeneye|Eared Grebe|Western Grebe|Band-tailed Pigeon|Eurasian Collared-Dove|Common Ground-Dove|Groove-billed Ani|Lesser Nighthawk|Black Swift|Mexican Violetear|Black-chinned Hummingbird|Calliope Hummingbird|Rufous Hummingbird|Allen's Hummingbird|Broad-tailed Hummingbird|Broad-billed Hummingbird|Corn Crake|Purple Gallinule|Yellow Rail|Limpkin|Northern Lapwing|European Golden-Plover|Pacific Golden-Plover|Wilson's Plover|Mountain Plover|Long-billed Curlew|Bar-tailed Godwit|Black-tailed Godwit|Ruff|Sharp-tailed Sandpiper|Curlew Sandpiper|Red-necked Stint|Little Stint|Wood Stork|Magnificent Frigatebird|Masked Booby|Brown Booby|Red-footed Booby|Anhinga|Roseate Spoonbill|Swainson's Hawk|Zone-tailed Hawk|Ash-throated Flycatcher|Tropical Kingbird|Cassin's Kingbird|Scissor-tailed Flycatcher|Fork-tailed Flycatcher|Mountain Bluebird|Townsend's Solitaire|Varied Thrush|Northern Wheatear|Brambling|Western Tanager|Black-headed Grosbeak|Lazuli Bunting".split('|'):add('NJ',name)
for name in ['American Avocet','Tricolored Heron','Northern Shrike']:add('RI',name)
# Retain simple single-interval Vermont seasonal rules only. Multiple intervals,
# plus signs, and geographical conditions need separate interpretation.
for line in (source_directory/'VTpdf.txt').read_text().splitlines():
 m=re.match(r'^\s*\d+\s+(.+?)\s{2,}[A-Z][a-z]+ [a-z]+\s+(.*?)\s+(\d{1,2}[ABCD])-(\d{1,2}[ABCD])\s*$',line)
 if m and re.fullmatch(r'[ *N]*',m[2]) and not any(r['state']=='US-VT' and r['name']==m[1].strip() for r in j['rules']):
  add('VT',m[1].strip(),kind='seasonal-outside',arrival=m[3],departure=m[4])
j['rules']=[r for r in j['rules'] if r['name'] not in ['Labrador Duck','Passenger Pigeon','Carolina Parakeet','Great Auk','Eskimo Curlew','Ivory-billed Woodpecker']]
p.write_text(json.dumps(j,indent=2)+'\n')
print('Sources',len(j['sources']),'rules',len(j['rules']),'seasonal',sum(r['kind']!='state-review' for r in j['rules']))

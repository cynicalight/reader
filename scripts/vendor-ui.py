"""Fetch unmodified shadcn Base Nova components; rewrite only local import aliases."""
import json, pathlib, urllib.request
components = ['button','badge','input','textarea','tabs','dialog','separator','scroll-area','tooltip','popover','select','resizable','skeleton']
for name in components:
    source = f'https://ui.shadcn.com/r/styles/base-nova/{name}.json'
    data = json.load(urllib.request.urlopen(source))
    for file in data['files']:
        content = file['content'].replace('from "cn"', 'from "@reader/ui/lib/utils"').replace('@/lib/utils', '@reader/ui/lib/utils').replace('@/components/ui/', '@reader/ui/components/').replace('@/registry/base-nova/ui/', '@reader/ui/components/')
        target = pathlib.Path('packages/ui/src/components') / pathlib.Path(file['path']).name
        target.write_text(content)
    print(name)

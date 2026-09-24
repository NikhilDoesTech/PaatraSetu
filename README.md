# PaatraSetu
It's a project for AMIHACKS, But also a foundation for something bigger, Something that can be implemented at a large scale and can be made into an organization. It contains all the Ideas we have gathered as a team and the various ways that it can be solved.

## Presentation demo

Run the app through the Python server (GitHub Pages alone cannot provide the API or shared
donation state):

```bash
cd docs
python3 server.py
```

Open `http://localhost:8001` and sign in with:

- Username: `admin`
- Password: `admin`

The demo account can post food offers. Volunteers can be created from the Join section and
will see eligible nearby offers in their volunteer dashboard, where they can accept or complete
a pickup. SMS delivery is intentionally represented by a server-side notification hook in
`docs/server.py`; connect that hook to an SMS provider for production use.

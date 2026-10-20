import { Route, Switch } from "wouter";
import { Layout } from "./components/layout";
import Home from "./pages/home";
import ConversationPage from "./pages/conversation";

export default function App() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/c/:id" component={ConversationPage} />
        <Route>
          <div className="p-8 text-slate-500">Page not found.</div>
        </Route>
      </Switch>
    </Layout>
  );
}

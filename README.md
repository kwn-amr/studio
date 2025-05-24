
# Subject Arbor: AI-Powered Knowledge Graph Explorer

Subject Arbor is a Next.js application that allows users to generate and explore interactive, hierarchical tree graphs for various fields of study. It leverages AI models via direct Cerebras API integration or OpenRouter (allowing access to models like Llama3 and Qwen) to dynamically generate the subject trees, including node descriptions.

## Features

-   **AI-Powered Subject Tree Generation**: Enter a field of study and get a detailed hierarchical graph.
-   **Node Descriptions**: Each node in the tree comes with a concise AI-generated description, visible on hover.
-   **Interactive D3.js Graph View**:
    -   Zoom and pan functionality.
    -   Click nodes to expand/collapse their children.
    -   Dynamically generate more children for any node by clicking it.
    -   Export graph as PNG.
-   **List View**: A traditional hierarchical list representation of the subject tree.
-   **Export Options**: Export the generated tree data as JSON or Markdown.
-   **Configurable AI Backend**:
    -   Switch between using the **Cerebras API directly** (with the Qwen-32B model).
    -   Use **OpenRouter** to access different models and providers:
        -   Chutes provider with Qwen3-30B (utilizes OpenRouter's schema enforcement).
        -   Cerebras provider with Qwen3-32B or Llama3.3-70B (relies on prompt engineering for JSON structure due to provider limitations with recursive schemas).
    -   The active AI backend configuration is displayed in toast notifications, including generation time and token usage (if available from OpenRouter).

## Tech Stack

-   **Next.js**: React framework for server-side rendering and static site generation.
-   **React**: JavaScript library for building user interfaces.
-   **TypeScript**: Superset of JavaScript adding static typing.
-   **D3.js**: JavaScript library for data visualization (used for the interactive graph view).
-   **ShadCN UI Components**: Collection of accessible and customizable UI components.
-   **Tailwind CSS**: Utility-first CSS framework for styling.
-   **Lucide Icons**: Icon library.
-   **Cerebras SDK / OpenRouter API**: For AI model interactions.

## Setup

1.  **Clone the repository (if applicable)**:
    ```bash
    git clone <repository_url>
    cd <project_directory>
    ```

2.  **Install dependencies**:
    ```bash
    npm install
    # or
    yarn install
    # or
    pnpm install
    ```

3.  **Set up Environment Variables**:
    Create a `.env` file in the root of your project and add your API keys:
    ```env
    # Required if you want to use the "OpenRouter" option
    OPENROUTER_API_KEY="your_openrouter_api_key_here"

    # Required if you want to use the "Cerebras (Direct)" option
    CEREBRAS_API_KEY="your_cerebras_api_key_here"

    # Optional: For OpenRouter, helps identify your app in their logs
    NEXT_PUBLIC_SITE_URL="http://localhost:9002" # Or your deployed URL
    NEXT_PUBLIC_APP_TITLE="Subject Arbor App"
    ```
    Replace `"your_openrouter_api_key_here"` and `"your_cerebras_api_key_here"` with your actual API keys.

## Running the Application

1.  **Development Mode**:
    To run the app in development mode with hot-reloading:
    ```bash
    npm run dev
    ```
    The application will typically be available at `http://localhost:9002`.

2.  **Build for Production**:
    To build the application for production:
    ```bash
    npm run build
    ```

3.  **Start Production Server**:
    After building, to start the production server:
    ```bash
    npm run start
    ```

## How to Use

1.  Start the application.
2.  Use the settings icon (gear in the top right) to select your preferred AI backend (OpenRouter with a specific provider/model, or Cerebras Direct).
3.  Enter a "Field of Study" in the input form on the left.
4.  Click "Generate Tree".
5.  Explore the generated subject tree in either the "List View" or the interactive "Graph View".
    -   In the Graph View, click nodes to expand/collapse them and to generate more sub-topics.
    -   Hover over nodes to see their descriptions.
6.  Use the export buttons to save the tree data as JSON or Markdown, or export the D3 graph as a PNG.

## Project Structure

-   `src/app/`: Main Next.js app router pages and layouts.
-   `src/components/`: React components, including ShadCN UI components and custom app components.
    -   `src/components/subject-arbor/`: Components specific to the Subject Arbor functionality.
-   `src/ai/flows/`: Server-side functions that interact with the AI APIs.
-   `src/lib/`: Utility functions.
-   `src/types/`: TypeScript type definitions.
-   `public/`: Static assets.
-   `globals.css`: Global styles and Tailwind CSS setup.
```